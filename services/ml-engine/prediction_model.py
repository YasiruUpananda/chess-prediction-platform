import math
import os
import chess

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


PRIOR_STRENGTH = float(os.getenv('HISTORY_PRIOR_STRENGTH', '20'))
if not math.isfinite(PRIOR_STRENGTH) or PRIOR_STRENGTH <= 0:
    raise ValueError('HISTORY_PRIOR_STRENGTH must be positive and finite')


def combine_history_and_heuristic(scored_moves, historical_counts, prior_strength=PRIOR_STRENGTH):
    if not math.isfinite(prior_strength) or prior_strength <= 0:
        raise ValueError('Prior strength must be a positive finite value')
    prior = relative_move_preferences(scored_moves)
    total = sum(max(0, historical_counts.get(move.uci(), 0)) for move, _ in prior)
    return [(move, (max(0, historical_counts.get(move.uci(), 0)) + prior_strength * probability)
                   / (total + prior_strength)) for move, probability in prior]
