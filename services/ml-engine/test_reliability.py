import asyncio
import io
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import chess
import chess.pgn
from fastapi import HTTPException

import main
import predict_opponent
import task_queue
import worker


class ReliabilityTests(unittest.TestCase):
    def test_cache_outages_do_not_break_predictions(self):
        for cache in [SimpleNamespace(get=AsyncMock(side_effect=ConnectionError()),
                                      setex=AsyncMock(side_effect=ConnectionError())),
                      SimpleNamespace(get=AsyncMock(return_value='invalid JSON'), setex=AsyncMock())]:
            with patch.object(main, 'redis_client', cache), patch.object(main, 'find_historical_move_counts', return_value={}):
                result = asyncio.run(main.predict_move(main.MovePredictionRequest(fen=chess.STARTING_FEN), {}))
            self.assertIn(chess.Move.from_uci(result['suggested_move']), chess.Board().legal_moves)
            self.assertFalse(result['cached'])

    def test_cache_timeout_is_bounded(self):
        async def slow(*args):
            await asyncio.sleep(10)
        cache = SimpleNamespace(get=slow, setex=slow)
        with patch.object(main, 'redis_client', cache), patch.object(main, 'find_historical_move_counts', return_value={}):
            result = asyncio.run(asyncio.wait_for(main.predict_move(main.MovePredictionRequest(fen=chess.STARTING_FEN), {}), 2))
        self.assertTrue(result['success'])

    def test_empty_evidence_never_calls_model(self):
        with patch.object(predict_opponent, 'evidence_count', return_value=0), patch.object(predict_opponent, 'ChatGoogleGenerativeAI') as model:
            with self.assertRaises(predict_opponent.InsufficientGameData):
                predict_opponent.generate_chess_prediction('Nobody')
            model.assert_not_called()

    def test_api_reports_insufficient_evidence(self):
        with patch.object(main, 'generate_chess_prediction', side_effect=predict_opponent.InsufficientGameData('Insufficient game data')):
            with self.assertRaises(HTTPException) as error:
                main.predict_strategy(main.StrategyPredictionRequest(opponent_name='Nobody'), {})
        self.assertEqual(error.exception.status_code, 422)

    def test_retry_is_confirmed_before_ack_and_bounded(self):
        for attempts, error, destination in [(0, RuntimeError(), task_queue.RETRY_QUEUE),
                (2, RuntimeError(), task_queue.DEAD_QUEUE), (0, ValueError(), task_queue.DEAD_QUEUE)]:
            channel = Mock()
            task_queue.finish(channel, 1, b'{}', attempts, error)
            self.assertEqual(channel.mock_calls[0].kwargs['routing_key'], destination)
            self.assertEqual(channel.mock_calls[-1][0], 'basic_ack')

    def test_failed_publish_leaves_original_unacked(self):
        channel = Mock()
        channel.basic_publish.side_effect = ConnectionError()
        with self.assertRaises(ConnectionError):
            task_queue.finish(channel, 1, b'{}', 0, RuntimeError())
        channel.basic_ack.assert_not_called()

    def test_bad_messages_and_paths_are_rejected(self):
        for body in [b'bad json', b'[]', b'{"filename":"../secret.pgn"}', b'{}']:
            with self.assertRaises(ValueError):
                worker.decode_task(body)

    def test_game_id_ignores_comments(self):
        first = chess.pgn.read_game(io.StringIO('1. e4 e5 *'))
        second = chess.pgn.read_game(io.StringIO('1. e4 {comment} e5 *'))
        self.assertEqual(worker.game_identity(first), worker.game_identity(second))


if __name__ == '__main__':
    unittest.main()
