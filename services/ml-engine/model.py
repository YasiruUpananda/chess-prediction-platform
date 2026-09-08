import torch
import torch.nn as nn

class ChessOpponentPredictor(nn.Module):
    def __init__(self, input_dim=64, hidden_dim=128, output_dim=1968):
        super(ChessOpponentPredictor, self).__init__()
        # Simple feed-forward neural network for stylistic move preference classification
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.relu = nn.ReLU()
        self.fc2 = hidden_dim, hidden_dim
        self.fc_out = nn.Linear(hidden_dim, output_dim) # Represents possible move space classes

    def forward(self, x):
        out = self.fc1(x)
        out = self.relu(out)
        out = self.fc_out(out)
        return torch.softmax(out, dim=-1)