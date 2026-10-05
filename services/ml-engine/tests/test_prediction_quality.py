import unittest
import chess
from chess_positions import position_key, validated_board
from prediction_model import combine_history_and_heuristic, score_legal_moves
from engine_pool import engine_cache_key


class QualityTests(unittest.TestCase):
    def test_sample_size_changes_preference(self):
        scored = score_legal_moves(chess.Board())
        small = dict((m.uci(), p) for m, p in combine_history_and_heuristic(scored, {"e2e4": 1}))
        large = dict((m.uci(), p) for m, p in combine_history_and_heuristic(scored, {"e2e4": 1000, "a1a8": 9999}))
        self.assertGreater(large["e2e4"], small["e2e4"])
        self.assertAlmostEqual(sum(large.values()), 1)

    def test_legal_en_passant_changes_key(self):
        board = chess.Board()
        for uci in ["e2e4", "a7a6", "e4e5", "d7d5"]:
            board.push_uci(uci)
        other = board.copy()
        other.ep_square = None
        self.assertNotEqual(position_key(board), position_key(other))

    def test_history_retains_repetition(self):
        moves = ["g1f3", "g8f6", "f3g1", "f6g8"] * 2
        board = chess.Board()
        for move in moves:
            board.push_uci(move)
        restored = validated_board(board.fen(), chess.STARTING_FEN, moves)
        self.assertTrue(restored.can_claim_threefold_repetition())
        self.assertNotEqual(engine_cache_key(restored, chess.Move.from_uci("e2e4"), .25, 1000),
                            engine_cache_key(chess.Board(board.fen()), chess.Move.from_uci("e2e4"), .25, 1000))

    def test_invalid_and_mismatched_positions_rejected(self):
        with self.assertRaises(ValueError):
            validated_board("8/8/8/8/8/8/8/8 w - - 0 1")
        with self.assertRaises(ValueError):
            validated_board(chess.STARTING_FEN, chess.STARTING_FEN, ["e2e4"])


if __name__ == "__main__":
    unittest.main()
