"""Retired entry point: use worker.process_pgn and player-scoped reports."""
def process_and_store_pgn(*_args, **_kwargs):
    raise RuntimeError('Use worker.process_pgn for validated, deduplicated ingestion.')

def retrieve_similar_games(*_args, **_kwargs):
    raise RuntimeError('Use predict_opponent.supporting_games for player-scoped evidence.')
