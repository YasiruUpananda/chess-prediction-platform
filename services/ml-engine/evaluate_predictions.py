"""Evaluate likelihood predictions on whole held-out games without train/test leakage."""
import argparse
import collections
import hashlib
import json
import math
from datetime import date
import chess.pgn
from chess_positions import position_key
from prediction_model import combine_history_and_heuristic, score_legal_moves
from game_identity import game_identity, participant_identity


def partition_games(games, split):
    groups = {'train': [], 'validation': [], 'test': []}
    if split == 'hash':
        for digest, game in games.items():
            bucket = int(digest[:8], 16) % 10
            groups['test' if bucket < 2 else 'validation' if bucket < 4 else 'train'].append(game)
        if any(not rows for rows in groups.values()):
            raise ValueError('More games are required for train/validation/test evaluation')
        return groups, 0
    dated = collections.defaultdict(list)
    excluded = 0
    for game in games.values():
        try:
            day = date.fromisoformat(game.headers.get('Date', '').replace('.', '-'))
        except ValueError:
            excluded += 1
            continue
        dated[day].append(game)
    days = sorted(dated)
    if len(days) < 3:
        raise ValueError('Chronological evaluation needs three distinct complete dates; --split hash is a diagnostic fallback')
    first = max(1, min(len(days)-2, int(len(days)*.6)))
    second = max(first+1, min(len(days)-1, int(len(days)*.8)))
    for name, selected in [('train', days[:first]), ('validation', days[first:second]), ('test', days[second:])]:
        groups[name] = [game for day in selected for game in dated[day]]
    return groups, excluded


def evaluate(path, split='chronological', strengths=(5, 10, 20, 40, 80)):
    games = {}
    with open(path, encoding="utf-8-sig") as source:
        while (game := chess.pgn.read_game(source)) is not None:
            if game.errors:
                continue
            digest = game_identity(game)
            games.setdefault(digest, game)
    train = collections.defaultdict(collections.Counter)
    partitions, excluded = partition_games(games, split)
    def positions(selected):
        rows = []
        for game in selected:
            board = game.board()
            for move in game.mainline_moves():
                player = participant_identity(game.headers,'White' if board.turn else 'Black')
                rows.append((board.copy(stack=False), move.uci(), player, game.headers.get('ECO', 'Unknown')))
                board.push(move)
        return rows
    for game in partitions['train']:
        seen = set()
        for board, actual, player, _ in positions([game]):
            key = (player, position_key(board))
            if key not in seen:
                train[key][actual] += 1
                seen.add(key)
    validation = positions(partitions['validation'])
    held = positions(partitions['test'])
    if not validation or not held:
        raise ValueError('Validation and test games must contain legal moves')
    scored_validation = [(score_legal_moves(board), train[(player, position_key(board))], actual)
                         for board, actual, player, _ in validation]
    losses = {strength: sum(-math.log(max(dict((move.uci(), p) for move, p in
              combine_history_and_heuristic(scored, counts, strength)).get(actual, 0), 1e-15))
              for scored, counts, actual in scored_validation)/len(validation) for strength in strengths}
    chosen = min(losses, key=lambda strength: (losses[strength], strength))
    groups = collections.defaultdict(list)
    for board, actual, player, opening in held:
        counts = train[(player, position_key(board))]
        ranked = sorted(combine_history_and_heuristic(score_legal_moves(board), counts, chosen), key=lambda x: (-x[1], x[0].uci()))
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
    return {'split':split, 'unique_games':len(games), 'excluded_undated_games':excluded,
            'split_games':{key:len(value) for key,value in partitions.items()},
            'held_out_games':len(partitions['test']), 'prior_strength':chosen,
            'tuning':{'metric':'validation log loss','validation_positions':len(validation),'losses':losses},
            'evidence_coverage':1-len(groups['sample_size:0'])/len(held),
            'metrics':{k:summarize(v) for k,v in sorted(groups.items()) if v}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pgn")
    parser.add_argument("--output")
    parser.add_argument('--split', choices=['chronological','hash'], default='chronological')
    args = parser.parse_args()
    result = json.dumps(evaluate(args.pgn,args.split), indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as target:
            target.write(result + "\n")
    else:
        print(result)
