import asyncio
import json
import logging
import math
import os
from uuid import UUID
from pathlib import Path
from typing import Any, Optional

import chess
import redis.asyncio as aioredis
import psycopg
from dotenv import find_dotenv, load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

# Automatically find and load .env from the current or parent directory
load_dotenv(find_dotenv())

from predict_opponent import generate_chess_prediction, InsufficientGameData, StrategyNotConfigured
from database import init_db
from task_queue import enqueue
import ocr_jobs
from token_auth import require_asgardeo_user

logger = logging.getLogger("neuro_chess.api")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# --- FastAPI Initialization ---
app = FastAPI(
    title="Neuro Chess ML Engine",
    description="Asgardeo-protected API for chess move recommendations, RAG strategy analysis, and PDF move extraction.",
    version="2.0.0",
)

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

@app.on_event("startup")
async def startup_event():
    global redis_client
    await asyncio.to_thread(init_db)
    try:
        redis_client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=0.25, socket_timeout=0.25, retry_on_timeout=False)
        await asyncio.wait_for(redis_client.ping(), timeout=0.3)
        logger.info("Connected to Redis")
    except Exception as e:
        logger.warning("Redis unavailable; continuing without cache: %s", e)

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.aclose()

# --- Pydantic Request & Response Schemas ---
class MovePredictionRequest(BaseModel):
    fen: str = Field(min_length=10, max_length=120)
    opponent_username: Optional[str] = Field(default="Opponent", max_length=120)


class MovePredictionResponse(BaseModel):
    success: bool
    opponent: str
    fen: str
    top_predicted_move: str
    san_move: str
    suggested_move: str
    confidence: float
    confidence_type: str = "relative_heuristic"
    prediction_source: str = "position_heuristic"
    cached: Optional[bool] = False


class StrategyPredictionRequest(BaseModel):
    opponent_name: str = Field(min_length=1, max_length=120)
    context: str = Field(default="", max_length=2000)


class StrategyPredictionResponse(BaseModel):
    opponent: str
    strategy_analysis: str
    supporting_games: int
    available_games: int


PIECE_VALUES = {
    chess.PAWN: 1.0,
    chess.KNIGHT: 3.0,
    chess.BISHOP: 3.2,
    chess.ROOK: 5.0,
    chess.QUEEN: 9.0,
    chess.KING: 0.0,
}
CENTER_SQUARES = (chess.D4, chess.E4, chess.D5, chess.E5)


def score_legal_moves(board: chess.Board) -> list[tuple[chess.Move, float]]:
    """Rank legal moves with a small, transparent one-ply positional heuristic."""
    mover = board.turn
    ranked = []
    for move in board.legal_moves:
        moved_piece = board.piece_at(move.from_square)
        if moved_piece is None:
            continue

        captured_piece = board.piece_at(move.to_square)
        if board.is_en_passant(move):
            captured_piece = chess.Piece(chess.PAWN, not mover)
        score = PIECE_VALUES[captured_piece.piece_type] * 0.8 if captured_piece else 0.0

        if move.promotion:
            score += PIECE_VALUES[move.promotion] - PIECE_VALUES[chess.PAWN]

        before_distance = min(chess.square_distance(move.from_square, center) for center in CENTER_SQUARES)
        after_distance = min(chess.square_distance(move.to_square, center) for center in CENTER_SQUARES)
        score += (before_distance - after_distance) * 0.035

        next_board = board.copy(stack=False)
        next_board.push(move)
        if next_board.is_check():
            score += 0.25
        if board.is_castling(move):
            score += 0.2

        destination_piece = next_board.piece_at(move.to_square)
        if destination_piece and next_board.is_attacked_by(not mover, move.to_square):
            attackers = len(next_board.attackers(not mover, move.to_square))
            defenders = len(next_board.attackers(mover, move.to_square))
            if attackers > defenders:
                score -= PIECE_VALUES[destination_piece.piece_type] * 0.55

        ranked.append((move, score))
    return ranked


def relative_move_preferences(scored_moves: list[tuple[chess.Move, float]]) -> list[tuple[chess.Move, float]]:
    """Normalize heuristic rankings; values are not empirical win probabilities."""
    if not scored_moves:
        return []
    temperature = 0.7
    max_score = max(score for _, score in scored_moves)
    weights = [math.exp((score - max_score) / temperature) for _, score in scored_moves]
    total = sum(weights)
    return [(scored_moves[index][0], weights[index] / total) for index in range(len(weights))]


def find_historical_move_counts(player_name: str, fen: str) -> dict[str, int]:
    """Read exact-position move frequencies for a player from ingested PGNs."""
    database_url = os.getenv("WORKER_DATABASE_URL") or os.getenv("DATABASE_URL", "")
    database_url = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    if not database_url or not player_name or player_name == "Opponent":
        return {}
    with psycopg.connect(database_url, connect_timeout=3) as connection:
        rows = connection.execute(
            """SELECT move_played, COUNT(*) AS times_played
               FROM player_moves
               WHERE lower(player_name) = lower(%s)
                 AND split_part(fen, ' ', 1) = split_part(%s, ' ', 1)
                 AND split_part(fen, ' ', 2) = split_part(%s, ' ', 2)
                 AND split_part(fen, ' ', 3) = split_part(%s, ' ', 3)
               GROUP BY move_played""",
            (player_name, fen, fen, fen),
        ).fetchall()
    return {move_uci: count for move_uci, count in rows}


def combine_history_and_heuristic(
    scored_moves: list[tuple[chess.Move, float]], historical_counts: dict[str, int],
) -> list[tuple[chess.Move, float]]:
    heuristic = relative_move_preferences(scored_moves)
    if not historical_counts:
        return heuristic
    legal_history = {move.uci(): historical_counts.get(move.uci(), 0) for move, _ in scored_moves}
    total_history = sum(legal_history.values())
    if not total_history:
        return heuristic
    return [
        (move, 0.9 * legal_history[move.uci()] / total_history + 0.1 * heuristic_probability)
        for (move, _), (_, heuristic_probability) in zip(scored_moves, heuristic)
    ]


# --- Endpoints ---

@app.get("/", include_in_schema=False)
def redirect_to_docs():
    """Redirects the base URL to interactive documentation."""
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check():
    """Unauthenticated liveness endpoint for container monitoring."""
    return {"status": "ok"}


@app.post("/api/v1/predict-move", response_model=MovePredictionResponse)
async def predict_move(request: MovePredictionRequest, _user: dict[str, Any] = Depends(require_asgardeo_user)):
    """Rank legal moves with a transparent heuristic and optional Redis cache."""
    try:
        try:
            board = chess.Board(request.fen)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Invalid FEN position.") from error

        if board.is_game_over():
            raise HTTPException(status_code=400, detail="Game is already over.")

        opponent = request.opponent_username or "Opponent"
        cache_key = f"move:v2:{opponent.casefold()}:{board.fen()}"
        if redis_client:
            try:
                cached_data = await asyncio.wait_for(redis_client.get(cache_key), timeout=0.3)
                if cached_data:
                    cached_res = MovePredictionResponse(**json.loads(cached_data)).model_dump()
                    cached_res["cached"] = True
                    return cached_res
            except Exception as error:
                logger.warning("Cache read skipped (%s)", type(error).__name__)

        scored_moves = score_legal_moves(board)
        try:
            historical_counts = await asyncio.to_thread(find_historical_move_counts, opponent, board.fen())
        except Exception as error:
            logger.warning("Could not load opponent move history; using position heuristic: %s", error)
            historical_counts = {}
        preferences = combine_history_and_heuristic(scored_moves, historical_counts)
        if not preferences:
            raise HTTPException(status_code=400, detail="No legal moves available.")

        selected_move, preference = max(preferences, key=lambda item: item[1])
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
            "confidence_type": "historical_frequency" if used_opponent_history else "relative_heuristic",
            "prediction_source": "opponent_history" if used_opponent_history else "position_heuristic",
            "cached": False,
        }

        # Brief TTL lets newly ingested history become visible quickly.
        if redis_client:
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
def trigger_ingest(request: IngestRequest, _user: dict[str, Any] = Depends(require_asgardeo_user)):
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
def predict_strategy(request: StrategyPredictionRequest, _user: dict[str, Any] = Depends(require_asgardeo_user)):
    """Generates an in-depth strategic analysis using Gemini and PostgreSQL (pgvector)."""
    try:
        analysis_result = generate_chess_prediction(request.opponent_name, request.context)
        return StrategyPredictionResponse(opponent=request.opponent_name, **analysis_result)
    except InsufficientGameData as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except StrategyNotConfigured as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.exception("Strategy analysis failed")
        raise HTTPException(status_code=500, detail="Strategy analysis failed. Check the service logs.") from e

@app.post("/api/v1/extract-page-moves", status_code=202)
async def extract_page_moves(
    file: UploadFile = File(...), page: int = Form(...),
    _user: dict[str, Any] = Depends(require_asgardeo_user),
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


@app.get("/api/v1/ocr-jobs/{job_id}")
def ocr_status(job_id: UUID, _user: dict[str, Any] = Depends(require_asgardeo_user)):
    job = ocr_jobs.get(job_id, _user["sub"])
    if job is None:
        raise HTTPException(status_code=404, detail="OCR job not found or expired.")
    return job
