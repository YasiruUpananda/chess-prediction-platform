from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from model import ChessOpponentPredictor

app = FastAPI(title="Chess Opponent Prediction Engine", version="1.0")

# Initialize model (in a real training pipeline, you would load saved model weights here)
model = ChessOpponentPredictor()
model.eval()

class PredictionRequest(BaseModel):
    fen: str
    opponent_username: str

@app.post("/predict-move")
async def predict_move(request: PredictionRequest):
    try:
        # Mocking input feature transformation from FEN string for inference demo
        dummy_tensor = torch.randn(1, 64)
        with torch.no_grad():
            probabilities = model(dummy_tensor)
            
        # Return mock top predicted move indices/probabilities for the specific opponent
        return {
            "success": True,
            "opponent": request.opponent_username,
            "fen": request.fen,
            "top_predicted_move": "Nf3",
            "confidence": 0.87
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ML Engine is running"}