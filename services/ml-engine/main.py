import asyncio
import json
import logging
import os
from uuid import UUID
from pathlib import Path
from typing import Any, Optional, Literal
from contextlib import asynccontextmanager

import chess
import redis.asyncio as aioredis
from dotenv import find_dotenv, load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

# Automatically find and load .env from the current or parent directory
load_dotenv(find_dotenv())

from predict_opponent import (generate_chess_prediction, strategy_events, StrategyReport,
                              InsufficientGameData, StrategyNotConfigured, StrategyBusy, StrategyProviderUnavailable)
from database import init_db, connect, close_pool, data_version, get_pool
from chess_positions import position_key, validated_board
from prediction_model import score_legal_moves, combine_history_and_heuristic, PRIOR_STRENGTH
from engine_pool import pool as engine_pool
from task_queue import enqueue
import ocr_jobs
from token_auth import require_asgardeo_user
from operations import report_user, ocr_user, move_user, ingestion_user, require_ingestion_permission
from backend_health import readiness
from fastapi.responses import JSONResponse
from metrics import ApiMeasurements, CACHE, authorized
from studies import router as studies_router
from browser_metrics import router as browser_metrics_router

logger = logging.getLogger("neuro_chess.api")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# --- FastAPI Initialization ---
@asynccontextmanager
async def lifespan(instance):
    await startup_event()
    try:
        yield
    finally:
        await shutdown_event()


app = FastAPI(
    title="Neuro Chess ML Engine",
    description="Asgardeo-protected API for chess move recommendations, RAG strategy analysis, and PDF move extraction.",
    version="2.0.0",
    lifespan=lifespan,
)
app.include_router(studies_router)
app.include_router(browser_metrics_router)
app.add_middleware(ApiMeasurements)


@app.get('/metrics', include_in_schema=False)
def metric_snapshot(request: Request):
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    from fastapi.responses import Response
    if not os.getenv('METRICS_TOKEN'):
        raise HTTPException(503,detail='Metrics are disabled.')
    if not authorized(request.headers.get('Authorization','')):
        raise HTTPException(401,detail='Metrics authentication required.')
    from metrics import refresh_operational
    refresh_operational()
    return Response(generate_latest(),media_type=CONTENT_TYPE_LATEST)

from telemetry import configure
configure('neuro-chess-api')
if os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT'):
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    FastAPIInstrumentor.instrument_app(app, excluded_urls='health,ready')

# --- CORS Middleware ---
# Allows your React frontend to interact with this API without browser blocks
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Redis Setup ---
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = None

async def startup_event():
    global redis_client
    await asyncio.to_thread(init_db)
    app.state.embedding_warmup = asyncio.create_task(asyncio.to_thread(warm_embeddings))
    try:
        redis_client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=0.25, socket_timeout=0.25, retry_on_timeout=False)
        await asyncio.wait_for(redis_client.ping(), timeout=0.3)
        logger.info("Connected to Redis")
    except Exception as e:
        logger.warning("Redis unavailable; continuing without cache: %s", e)

async def shutdown_event():
    if hasattr(app.state, "embedding_warmup"):
        app.state.embedding_warmup.cancel()
    await asyncio.to_thread(engine_pool.close)
    if redis_client:
        await redis_client.aclose()
    await asyncio.to_thread(close_pool)

# --- Pydantic Request & Response Schemas ---
class MovePredictionRequest(BaseModel):
    fen: str = Field(min_length=10, max_length=120)
    opponent_username: Optional[str] = Field(default="Opponent", max_length=120)
    initial_fen: Optional[str] = Field(default=None, min_length=10, max_length=120)
    moves: Optional[list[str]] = Field(default=None, max_length=1500)


class MoveCandidate(BaseModel):
    san: str
    uci: str
    probability: float
    observed_games: int


class EngineLine(BaseModel):
    uci: str
    san: str
    score_white_cp: Optional[int] = None
    mate_white: Optional[int] = None
    depth: int = 0


class EngineEvaluation(BaseModel):
    status: Literal['available', 'unavailable', 'busy'] = 'unavailable'
    name: str = 'Stockfish 18'
    cached: bool = False
    best: Optional[EngineLine] = None
    alternatives: list[EngineLine] = Field(default_factory=list)
    predicted_move: Optional[EngineLine] = None
    score_perspective: Literal['white'] = 'white'
    time_limit_ms: Optional[int] = None
    node_limit: Optional[int] = None


class MovePredictionResponse(BaseModel):
    success: bool
    opponent: str
    fen: str
    top_predicted_move: Optional[str] = None
    san_move: Optional[str] = None
    suggested_move: Optional[str] = None
    confidence: float
    confidence_type: str = "relative_heuristic"
    prediction_source: str = "position_heuristic"
    cached: Optional[bool] = False
    matching_games: int = 0
    observed_games: int = 0
    history_weight: float = 0
    candidates: list[MoveCandidate] = Field(default_factory=list)
    engine: EngineEvaluation = Field(default_factory=EngineEvaluation)
    game_over: bool = False
    outcome: Optional[str] = None
    draw_claim_available: bool = False
    history_verified: bool = False


class StrategyPredictionRequest(BaseModel):
    opponent_name: str = Field(min_length=1, max_length=120)
    context: str = Field(default="", max_length=2000)
    color: Literal["any", "white", "black"] = "any"


class SourceGame(BaseModel):
    id: str
    white: str
    black: str
    event: str
    date: str
    result: str
    eco: str
    timecontrol: str
    pgn: str


class GameStatistic(BaseModel):
    id: str
    type: Literal['sample', 'result', 'opening', 'position']
    games: int
    game_ids: list[str]
    color: Optional[str] = None
    result: Optional[str] = None
    line: Optional[str] = None
    position_key: Optional[str] = None


class StrategyPredictionResponse(BaseModel):
    opponent: str
    report: StrategyReport
    sources: list[SourceGame]
    statistics: list[GameStatistic]
    supporting_games: int
    available_games: int
    cached: bool = False
    data_version: str
    model: str
    prompt_version: str
    context: str = ""
    color: str = "any"


def warm_embeddings():
    try:
        from rag_store import get_vector_store
        get_vector_store().embeddings.embed_query("chess opening")
        logger.info("Embedding model warmed")
    except Exception:
        logger.exception("Embedding warmup failed; retrieval will retry on demand")


def find_historical_move_counts(player_name, fen):
    key = position_key(chess.Board(fen))
    with connect() as db:
        rows = db.execute("""SELECT move_played, count(*) FROM (
            SELECT DISTINCT ON (p.game_id) p.move_played FROM player_moves p
            JOIN ingested_games g ON g.id=p.game_id
            WHERE g.indexed AND lower(trim(p.player_name))=%s AND p.position_key=%s
            ORDER BY p.game_id,p.ply
        ) samples GROUP BY move_played""", (player_name.strip().casefold(), key)).fetchall()
    return dict(rows)


# --- Endpoints ---

@app.get("/", include_in_schema=False)
def redirect_to_docs():
    """Redirects the base URL to interactive documentation."""
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check():
    """Unauthenticated liveness endpoint for container monitoring."""
    return {"status": "ok"}


@app.get("/ready")
def readiness_check():
    ready, dependencies = readiness()
    return JSONResponse({'status': 'ready' if ready else 'not_ready', 'dependencies': dependencies},
                        status_code=200 if ready else 503)


@app.get("/api/v1/operations")
def operational_status(_user: dict[str, Any] = Depends(require_ingestion_permission)):
    """Restricted operational counters; no uploaded documents or bearer tokens."""
    ready, dependencies = readiness()
    with connect() as db:
        jobs = dict(db.execute("SELECT status,count(*) FROM ocr_jobs GROUP BY status").fetchall())
        unindexed = db.execute("SELECT count(*) FROM ingested_games WHERE NOT indexed").fetchone()[0]
        ages = dict(db.execute("SELECT name,extract(epoch FROM now()-seen_at)::int FROM service_heartbeats").fetchall())
    from task_queue import connection, QUEUE, RETRY_QUEUE, DEAD_QUEUE
    queue_counts = {}
    try:
        with connection() as conn:
            channel = conn.channel()
            for name in (QUEUE, RETRY_QUEUE, DEAD_QUEUE):
                queue_counts[name] = channel.queue_declare(queue=name, passive=True).method.message_count
    except Exception:
        queue_counts = {"status": "unavailable"}
    return {'ready': ready, 'dependencies': dependencies, 'worker_age_seconds': ages,
            'pool': get_pool().get_stats(), 'ocr_jobs': jobs, 'unindexed_games': unindexed,
            'ingestion_queues': queue_counts}


class PlayerSummary(BaseModel):
    name: str
    games: int

class PlayersResponse(BaseModel):
    players: list[PlayerSummary]

@app.get("/api/v1/players", response_model=PlayersResponse)
def available_players(_user: dict[str, Any] = Depends(require_asgardeo_user)):
    with connect() as db:
        rows = db.execute("""SELECT min(name), count(DISTINCT id) FROM (
            SELECT id,trim(white) AS name FROM ingested_games WHERE indexed
            UNION ALL SELECT id,trim(black) AS name FROM ingested_games WHERE indexed
        ) players WHERE name NOT IN ('Unknown','?','') GROUP BY lower(name) ORDER BY lower(name)""").fetchall()
    return {"players": [{"name": name, "games": count} for name, count in rows]}


@app.post("/api/v1/predict-move", response_model=MovePredictionResponse)
async def predict_move(request: MovePredictionRequest, _user: dict[str, Any] = Depends(move_user)):
    """Rank legal moves with a transparent heuristic and optional Redis cache."""
    try:
        try:
            board = validated_board(request.fen, request.initial_fen, request.moves)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        if board.is_game_over():
            return {"success": True, "opponent": request.opponent_username or "Opponent",
                    "fen": board.fen(), "confidence": 0, "game_over": True,
                    "outcome": board.outcome().termination.name.lower().replace("_", " "),
                    "history_verified": request.moves is not None}

        opponent = request.opponent_username or "Opponent"
        import hashlib
        history_signature = hashlib.sha256(json.dumps([board.root().fen(), [m.uci() for m in board.move_stack],
                                                       board.fen()]).encode()).hexdigest()
        try:
            version = await asyncio.to_thread(data_version)
        except Exception:
            version = None
            logger.warning("Dataset version unavailable; bypassing move cache")
        cache_key = f"move:v4:{version}:{opponent.strip().casefold()}:{history_signature}:{request.moves is not None}"
        if redis_client and version is not None:
            try:
                cached_data = await asyncio.wait_for(redis_client.get(cache_key), timeout=0.3)
                if cached_data:
                    cached_res = MovePredictionResponse(**json.loads(cached_data)).model_dump()
                    cached_res["cached"] = True
                    CACHE.labels('move','hit').inc()
                    return cached_res
                CACHE.labels('move','miss').inc()
            except Exception as error:
                CACHE.labels('move','error').inc()
                logger.warning("Cache read skipped (%s)", type(error).__name__)
        else:
            CACHE.labels('move','disabled').inc()

        scored_moves = await asyncio.to_thread(score_legal_moves, board)
        try:
            historical_counts = await asyncio.to_thread(find_historical_move_counts, opponent, board.fen())
        except Exception as error:
            logger.warning("Could not load opponent move history; using position heuristic: %s", error)
            historical_counts = {}
            version = None
        preferences = combine_history_and_heuristic(scored_moves, historical_counts)
        if not preferences:
            raise HTTPException(status_code=400, detail="No legal moves available.")

        preferences.sort(key=lambda item: (-item[1], item[0].uci()))
        selected_move, preference = preferences[0]
        matching_games = sum(historical_counts.get(move.uci(), 0) for move, _ in preferences)
        engine = await asyncio.to_thread(engine_pool.analyse, board, selected_move)
        used_opponent_history = any(historical_counts.get(move.uci(), 0) for move, _ in scored_moves)
        san = board.san(selected_move)
        uci = selected_move.uci()

        response_data = {
            "success": True,
            "opponent": request.opponent_username or "Opponent",
            "fen": board.fen(),
            "top_predicted_move": san,
            "san_move": san,
            "suggested_move": uci,
            "confidence": round(preference, 4),
            "confidence_type": "smoothed_move_estimate" if used_opponent_history else "relative_heuristic",
            "prediction_source": "opponent_history" if used_opponent_history else "position_heuristic",
            "cached": False,
            "matching_games": matching_games,
            "observed_games": historical_counts.get(uci, 0),
            "history_weight": matching_games / (matching_games + PRIOR_STRENGTH),
            "candidates": [{"san": board.san(move), "uci": move.uci(), "probability": probability,
                            "observed_games": historical_counts.get(move.uci(), 0)} for move, probability in preferences[:3]],
            "engine": engine,
            "draw_claim_available": board.can_claim_draw(),
            "history_verified": request.moves is not None,
        }

        # Brief TTL lets newly ingested history become visible quickly.
        if redis_client and version is not None and engine.get("status") == "available":
            try:
                await asyncio.wait_for(redis_client.setex(cache_key, 60, json.dumps(response_data)), timeout=0.3)
            except Exception as error:
                logger.warning("Cache write skipped (%s)", type(error).__name__)

        return response_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class IngestRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)

@app.post("/api/v1/ingest-async", status_code=202)
def trigger_ingest(request: IngestRequest, _user: dict[str, Any] = Depends(ingestion_user)):
    """Triggers an asynchronous PGN ingestion task via RabbitMQ."""
    data_dir = Path(os.getenv("PGN_DATA_DIR", "/app/data")).resolve()
    candidate = (data_dir / request.filename).resolve()
    if Path(request.filename).name != request.filename or candidate.parent != data_dir:
        raise HTTPException(status_code=400, detail="Only PGN filenames inside the approved data directory are accepted.")
    if candidate.suffix.lower() != ".pgn" or not candidate.is_file():
        raise HTTPException(status_code=404, detail="PGN file not found in the approved data directory.")

    try:
        enqueue(candidate.name)
    except Exception as error:
        logger.warning("Ingestion queue unavailable (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Ingestion queue is unavailable or full. Retry shortly.") from error
    return {"status": "Accepted", "message": f"Dataset {request.filename} queued for background processing."}

@app.post("/api/v1/predict-strategy", response_model=StrategyPredictionResponse)
async def predict_strategy(request: StrategyPredictionRequest, _user: dict[str, Any] = Depends(report_user)):
    """Generates an in-depth strategic analysis using Gemini and PostgreSQL (pgvector)."""
    try:
        analysis_result = await asyncio.wait_for(asyncio.to_thread(
            generate_chess_prediction, request.opponent_name, request.context, request.color), timeout=75)
        return StrategyPredictionResponse(**analysis_result)
    except InsufficientGameData as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except StrategyNotConfigured as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except StrategyProviderUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except StrategyBusy as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail="Strategy report deadline exceeded. Retry shortly.") from error
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.exception("Strategy analysis failed")
        raise HTTPException(status_code=500, detail="Strategy analysis failed. Check the service logs.") from e


@app.post("/api/v1/predict-strategy/stream")
async def stream_strategy(request: StrategyPredictionRequest,
                          _user: dict[str, Any] = Depends(report_user)):
    async def events():
        try:
            async for event in strategy_events(request.opponent_name, request.context, request.color):
                yield json.dumps(event) + "\n"
        except InsufficientGameData as error:
            yield json.dumps({"type": "error", "code": "insufficient_evidence", "detail": str(error)}) + "\n"
        except (StrategyNotConfigured, StrategyBusy, StrategyProviderUnavailable) as error:
            yield json.dumps({"type": "error", "code": "unavailable", "detail": str(error)}) + "\n"
        except TimeoutError:
            yield json.dumps({"type": "error", "code": "timeout", "detail": "Strategy report deadline exceeded. Retry shortly."}) + "\n"
        except Exception:
            logger.exception("Streaming strategy failed")
            yield json.dumps({"type": "error", "code": "generation_failed", "detail": "Could not validate or generate a cited report. Retry shortly."}) + "\n"
    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

class OcrTextItem(BaseModel):
    str: str
    x: float
    y: float
    width: float
    height: float
    confidence: float = 0


class OcrResult(BaseModel):
    page: int
    moves: list[str]
    text: str
    text_items: list[OcrTextItem]
    ocr_confidence: float
    extraction_version: str


class OcrJobResponse(BaseModel):
    job_id: str
    status: Literal['queued', 'running', 'completed', 'failed']
    result: Optional[OcrResult] = None
    error: Optional[str] = None
    cached: Optional[bool] = None


@app.post("/api/v1/extract-page-moves", status_code=202, response_model=OcrJobResponse)
async def extract_page_moves(
    file: UploadFile = File(...), page: int = Form(...),
    _user: dict[str, Any] = Depends(ocr_user),
):
    try:
        if page < 1:
            raise HTTPException(status_code=400, detail="Page number must be at least 1.")
        if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(status_code=415, detail="Upload a PDF file.")
        limit = int(os.getenv("MAX_PDF_BYTES", str(25 * 1024 * 1024)))
        content = await file.read(limit + 1)
        if len(content) > limit:
            raise HTTPException(status_code=413, detail="PDF exceeds the configured upload limit.")
        if b"%PDF-" not in content[:1024]:
            raise HTTPException(status_code=415, detail="The file is not a PDF.")
        return await asyncio.to_thread(ocr_jobs.submit, _user["sub"], page, content)
    except ocr_jobs.QueueFull as error:
        raise HTTPException(status_code=429, detail=str(error), headers={"Retry-After": "5"}) from error
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("OCR queue unavailable (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="OCR queue is temporarily unavailable.") from error
    finally:
        await file.close()


@app.get("/api/v1/ocr-jobs/{job_id}", response_model=OcrJobResponse)
def ocr_status(job_id: UUID, _user: dict[str, Any] = Depends(require_asgardeo_user)):
    job = ocr_jobs.get(job_id, _user["sub"])
    if job is None:
        raise HTTPException(status_code=404, detail="OCR job not found or expired.")
    return job


@app.post("/api/v1/extract-page-image", status_code=202, response_model=OcrJobResponse)
async def extract_page_image(file: UploadFile = File(...), page: int = Form(...), mode: Literal["page", "block", "line"] = Form("page"),
                             _user: dict[str, Any] = Depends(ocr_user)):
    try:
        if page<1:
            raise HTTPException(status_code=400,detail="Page number must be at least 1.")
        content = await file.read(8*1024*1024+1)
        if len(content)>8*1024*1024:
            raise HTTPException(status_code=413,detail="Page image exceeds the 8 MB limit.")
        try:
            job = await asyncio.to_thread(ocr_jobs.submit_image,_user['sub'],page,content,mode)
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400,detail=str(error)) from error
        return await asyncio.to_thread(ocr_jobs.get,job['job_id'],_user['sub'])
    except ocr_jobs.QueueFull as error:
        raise HTTPException(status_code=429,detail=str(error),headers={"Retry-After":"5"}) from error
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Page OCR queue unavailable (%s)",type(error).__name__)
        raise HTTPException(status_code=503,detail="OCR queue is temporarily unavailable.") from error
    finally:
        await file.close()
