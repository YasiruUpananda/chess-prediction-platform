"""Bounded reusable UCI engines with hard communication deadlines and TTL cache."""
import copy
import hashlib
import json
import os
import queue
import threading
import time
from collections import OrderedDict

import chess
import chess.engine
from telemetry import traced


def engine_cache_key(board, predicted_move, seconds, nodes):
    data = [board.root().fen(), [move.uci() for move in board.move_stack], board.fen(),
            predicted_move.uci(), seconds, nodes, "stockfish18-v1"]
    return hashlib.sha256(json.dumps(data).encode()).hexdigest()


def describe(info, board):
    move = info["pv"][0]
    score = info["score"].white()
    return {"uci": move.uci(), "san": board.san(move), "score_white_cp": score.score(),
            "mate_white": score.mate(), "depth": info.get("depth", 0)}


class EnginePool:
    def __init__(self, size=2):
        self.slots = queue.Queue(maxsize=size)
        for _ in range(size):
            self.slots.put(None)
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.seconds = min(max(float(os.getenv("STOCKFISH_TIME_SECONDS", "0.25")), 0.05), 2)
        self.nodes = min(max(int(os.getenv("STOCKFISH_NODES", "100000")), 1000), 1000000)

    @traced('stockfish.analyse')
    def analyse(self, board, predicted_move):
        key = engine_cache_key(board, predicted_move, self.seconds, self.nodes)
        with self.lock:
            entry = self.cache.get(key)
            if entry and entry[0] > time.monotonic():
                self.cache.move_to_end(key)
                result = copy.deepcopy(entry[1])
                result["cached"] = True
                return result
        try:
            engine = self.slots.get_nowait()
        except queue.Empty:
            return {"status": "busy", "name": "Stockfish 18", "cached": False}
        try:
            if engine is None:
                engine = chess.engine.SimpleEngine.popen_uci(os.getenv("STOCKFISH_PATH", "/usr/local/bin/stockfish"), timeout=3)
                engine.configure({"Threads": 1, "Hash": 64})
            limit = chess.engine.Limit(time=self.seconds, nodes=self.nodes)
            infos = engine.analyse(board, limit, multipv=min(3, board.legal_moves.count()), game=object())
            lines = [describe(info, board) for info in infos if info.get("pv")]
            if not lines:
                raise RuntimeError("Engine returned no legal candidate")
            predicted = next((line for line in lines if line["uci"] == predicted_move.uci()), None)
            if predicted is None:
                info = engine.analyse(board, limit, root_moves=[predicted_move])
                predicted = describe(info, board)
            result = {"status": "available", "name": engine.id.get("name", "Stockfish 18"),
                      "best": lines[0], "alternatives": lines[1:], "predicted_move": predicted,
                      "score_perspective": "white", "cached": False,
                      "time_limit_ms": round(self.seconds * 1000), "node_limit": self.nodes}
            with self.lock:
                self.cache[key] = (time.monotonic() + 300, copy.deepcopy(result))
                self.cache.move_to_end(key)
                while len(self.cache) > 256:
                    self.cache.popitem(last=False)
            return result
        except Exception:
            if engine is not None:
                engine.close()
            engine = None
            return {"status": "unavailable", "name": "Stockfish 18", "cached": False}
        finally:
            self.slots.put_nowait(engine)

    def close(self):
        while not self.slots.empty():
            engine = self.slots.get_nowait()
            if engine is not None:
                engine.close()


pool = EnginePool(size=min(max(int(os.getenv("STOCKFISH_POOL_SIZE", "2")), 1), 4))
