"""Evaluate likelihood predictions on whole held-out games without train/test leakage."""
import argparse
import collections
import hashlib
import json
import math
import chess.pgn
from chess_positions import position_key
from prediction_model import combine_history_and_heuristic, score_legal_moves


def evaluate(path):
    games = {}
    with open(path, encoding="utf-8-sig") as source:
        while (game := chess.pgn.read_game(source)) is not None:
            if game.errors:
                continue
            identity = game.board().fen() + " " + " ".join(m.uci() for m in game.mainline_moves())
            digest = hashlib.sha256(identity.encode()).hexdigest()
            games.setdefault(digest, game)
    train = collections.defaultdict(collections.Counter)
    held = []
    for digest, game in games.items():
        board = game.board()
        seen = set()
        testing = int(digest[:8], 16) % 5 == 0
        for move in game.mainline_moves():
            player = game.headers.get("White" if board.turn else "Black", "Unknown").strip().lower()
            key = (player, position_key(board))
            if testing:
                held.append((board.copy(), move.uci(), player, game.headers.get("ECO", "Unknown")))
            elif key not in seen:
                train[key][move.uci()] += 1
                seen.add(key)
            board.push(move)
    groups = collections.defaultdict(list)
    for board, actual, player, opening in held:
        counts = train[(player, position_key(board))]
        ranked = sorted(combine_history_and_heuristic(score_legal_moves(board), counts), key=lambda x: (-x[1], x[0].uci()))
        probabilities = {move.uci(): p for move, p in ranked}
        n = sum(counts.get(move.uci(), 0) for move, _ in ranked)
        bucket = "0" if n == 0 else "1-4" if n < 5 else "5-19" if n < 20 else "20+"
        row = (int(ranked[0][0].uci() == actual), int(actual in [m.uci() for m, _ in ranked[:3]]),
               ranked[0][1], -math.log(max(probabilities.get(actual, 0), 1e-15)),
               sum((p - int(uci == actual)) ** 2 for uci, p in probabilities.items()))
        for group in ["overall", "player:" + player, "opening:" + opening, "sample_size:" + bucket]:
            groups[group].append(row)
    def summarize(rows):
        size = len(rows)
        ece = 0
        for b in range(10):
            bin_rows = [r for r in rows if min(9, int(r[2] * 10)) == b]
            if bin_rows:
                ece += abs(sum(r[0] - r[2] for r in bin_rows)) / size
        return dict(positions=size, top1=sum(r[0] for r in rows)/size, top3=sum(r[1] for r in rows)/size,
                    log_loss=sum(r[3] for r in rows)/size, brier=sum(r[4] for r in rows)/size, ece_10_bins=ece)
    return {"split": "sha256(initial position + moves) modulo 5; 20% held out; duplicate games removed",
            "unique_games": len(games), "held_out_games": sum(int(d[:8], 16) % 5 == 0 for d in games),
            "metrics": {k: summarize(v) for k, v in sorted(groups.items())}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pgn")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = json.dumps(evaluate(args.pgn), indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as target:
            target.write(result + "\n")
    else:
        print(result)
