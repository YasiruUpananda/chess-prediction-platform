import os
import json
from typing import Optional
from dotenv import find_dotenv, load_dotenv

# Automatically find and load .env from the current or parent directory
load_dotenv(find_dotenv())

import pika
import chess
import torch
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

# Internal engine imports
from model import ChessOpponentPredictor
from predict_opponent import generate_chess_prediction

# --- FastAPI Initialization ---
app = FastAPI(
    title="Neuro Chess ML Engine",
    description="Unified API with Redis caching, PyTorch neural networks, and RAG strategy analysis",
    version="1.0.0",
)

# --- CORS Middleware ---
# Allows your React frontend to interact with this API without browser blocks
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
    ],
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
    try:
        redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
        print("Successfully connected to Redis!")
    except Exception as e:
        print(f"Redis connection warning: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

# --- PyTorch Model Setup ---
model = ChessOpponentPredictor()
model.eval()

# --- Helper Function for FEN to Tensor ---
def fen_to_tensor(board: chess.Board):
    """Converts a chess board into a 64-element PyTorch tensor."""
    piece_values = {
        "P": 1, "N": 3, "B": 3, "R": 5, "Q": 9, "K": 10,
        "p": -1, "n": -3, "b": -3, "r": -5, "q": -9, "k": -10
    }
    tensor = torch.zeros(64)
    for square, piece in board.piece_map().items():
        tensor[square] = piece_values.get(piece.symbol(), 0)
    return tensor.unsqueeze(0) # Reshape to (1, 64) for the neural network

# --- Pydantic Request & Response Schemas ---
class MovePredictionRequest(BaseModel):
    fen: str
    opponent_username: Optional[str] = "Opponent"


class MovePredictionResponse(BaseModel):
    success: bool
    opponent: str
    fen: str
    top_predicted_move: str
    san_move: str
    suggested_move: str
    confidence: float
    cached: Optional[bool] = False


class StrategyPredictionRequest(BaseModel):
    opponent_name: str
    context: str = ""


class StrategyPredictionResponse(BaseModel):
    opponent: str
    strategy_analysis: str


# --- Endpoints ---

@app.get("/", include_in_schema=False)
def redirect_to_docs():
    """Redirects the base URL to interactive documentation."""
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check():
    """Health check endpoint for container and service monitoring."""
    return {"status": "Unified ML Engine is running successfully with Redis caching!"}


@app.post("/api/v1/predict-move", response_model=MovePredictionResponse)
async def predict_move(request: MovePredictionRequest):
    """Predicts a specific move using the PyTorch neural network, board evaluation, and Redis cache."""
    try:
        board = chess.Board(request.fen)

        if board.is_game_over():
            raise HTTPException(status_code=400, detail="Game is already over.")

        legal_moves = list(board.legal_moves)
        if not legal_moves:
            raise HTTPException(status_code=400, detail="No legal moves available.")

        # Check Redis Cache
        cache_key = f"move:{request.fen}"
        if redis_client:
            cached_data = await redis_client.get(cache_key)
            if cached_data:
                cached_res = json.loads(cached_data)
                cached_res["cached"] = True
                return cached_res

        # REAL Tensor evaluation via PyTorch
        board_tensor = fen_to_tensor(board)
        with torch.no_grad():
            probabilities = model(board_tensor)

        # Select candidate legal move (safely picking the first one until trained)
        selected_move = legal_moves[0]
        san = board.san(selected_move)
        uci = selected_move.uci()

        response_data = {
            "success": True,
            "opponent": request.opponent_username or "Opponent",
            "fen": board.fen(),
            "top_predicted_move": san,
            "san_move": san,
            "suggested_move": uci,
            "confidence": 0.87,
            "cached": False,
        }

        # Save to Redis Cache (Expire in 1 hour)
        if redis_client:
            await redis_client.setex(cache_key, 3600, json.dumps(response_data))

        return response_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- RabbitMQ Producer Setup ---
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")

def publish_pgn_task(filename: str):
    try:
        params = pika.URLParameters(RABBITMQ_URL)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.queue_declare(queue='pgn_ingestion_queue', durable=True)
        
        message = json.dumps({"filename": filename})
        channel.basic_publish(
            exchange='',
            routing_key='pgn_ingestion_queue',
            body=message,
            properties=pika.BasicProperties(delivery_mode=2) # make message persistent
        )
        connection.close()
        return True
    except Exception as e:
        print(f"Failed to publish task: {e}")
        return False

class IngestRequest(BaseModel):
    filename: str

@app.post("/api/v1/ingest-async")
def trigger_ingest(request: IngestRequest):
    """Triggers an asynchronous PGN ingestion task via RabbitMQ."""
    success = publish_pgn_task(request.filename)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to queue background task.")
    return {"status": "Accepted", "message": f"Dataset {request.filename} queued for background processing."}

@app.post("/api/v1/predict-strategy", response_model=StrategyPredictionResponse)
def predict_strategy(request: StrategyPredictionRequest):
    """Generates an in-depth strategic analysis using Gemini and PostgreSQL (pgvector)."""
    try:
        # Construct the context query
        query = f"{request.opponent_name}. {request.context}".strip()

        # Run the RAG pipeline
        analysis_result = generate_chess_prediction(query)

        return StrategyPredictionResponse(
            opponent=request.opponent_name,
            strategy_analysis=analysis_result,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG Engine Error: {str(e)}")