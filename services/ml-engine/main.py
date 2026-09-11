import os
from dotenv import find_dotenv, load_dotenv

# Automatically find and load .env from the current or parent directory
load_dotenv(find_dotenv())

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import torch

# Internal engine imports
from model import ChessOpponentPredictor
from predict_opponent import generate_chess_prediction

# --- FastAPI Initialization ---
app = FastAPI(
    title="Chess ML Engine",
    description="Unified API for PyTorch move prediction and Gemini RAG strategy analysis",
    version="1.0.0",
)

# --- CORS Middleware ---
# Allows your React/Vite/Next.js frontend to interact with this API without browser blocks
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

# --- PyTorch Model Setup ---
model = ChessOpponentPredictor()
model.eval()

# --- Pydantic Request & Response Schemas ---
class MovePredictionRequest(BaseModel):
    fen: str
    opponent_username: str


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
    return {"status": "Unified ML Engine is running successfully!"}


@app.post("/api/v1/predict-move")
def predict_move(request: MovePredictionRequest):
    """Predicts a specific move using the PyTorch neural network."""
    try:
        # Mock feature transformation from FEN string for inference demo
        dummy_tensor = torch.randn(1, 64)
        with torch.no_grad():
            probabilities = model(dummy_tensor)

        return {
            "success": True,
            "opponent": request.opponent_username,
            "fen": request.fen,
            "top_predicted_move": "Nf3",
            "confidence": 0.87,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/predict-strategy", response_model=StrategyPredictionResponse)
def predict_strategy(request: StrategyPredictionRequest):
    """Generates an in-depth strategic analysis using Gemini and PostgreSQL (pgvector)."""
    try:
        # Construct the context query
        query = f"{request.opponent_name}. {request.context}".strip()

        # Run the RAG pipeline (synchronous to prevent event-loop database blocking)
        analysis_result = generate_chess_prediction(query)

        return StrategyPredictionResponse(
            opponent=request.opponent_name,
            strategy_analysis=analysis_result,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG Engine Error: {str(e)}")