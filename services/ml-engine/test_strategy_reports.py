import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from pydantic import ValidationError
import predict_opponent as strategy


def report(reference='g1'):
    claim = {'text':'Observed evidence', 'confidence':'tentative', 'source_game_ids':[reference], 'statistic_ids':[]}
    return strategy.StrategyReport(profile=[claim], tendencies=[], weaknesses=[], recommendations=[], limitations=['Small sample'])


class StrategyTests(unittest.TestCase):
    def test_claims_require_evidence_and_known_references(self):
        with self.assertRaises(ValidationError):
            strategy.Claim(text='Unsupported',confidence='supported',source_game_ids=[],statistic_ids=[])
        with self.assertRaises(ValueError):
            strategy.validate_report(report('invented'), [{'id':'g1'}], [{'id':'sample'}])
        strategy.validate_report(report(), [{'id':'g1'}], [{'id':'sample'}])

    def test_foreign_player_docs_are_rejected_even_if_store_returns_them(self):
        store = Mock()
        store.similarity_search.return_value = [SimpleNamespace(metadata={'game_id':'g1','white_normalized':'other'},page_content='1. e4 *')]
        with patch.object(strategy,'get_vector_store',return_value=store):
            with self.assertRaises(strategy.InsufficientGameData):
                strategy.supporting_games('alice','',['g1'])
        self.assertIn('$and',store.similarity_search.call_args.kwargs['filter'])

    def test_small_sample_never_calls_model(self):
        with patch.object(strategy,'evidence_count',return_value=2), patch.object(strategy,'report_chain') as chain:
            with self.assertRaises(strategy.InsufficientGameData):
                strategy.generate_chess_prediction('Alice')
            chain.assert_not_called()

    def test_cache_outage_does_not_break_generation_and_statistics_arrive_first(self):
        stats = [{'id':'sample','games':3}]
        chain = SimpleNamespace(ainvoke=AsyncMock(return_value=report()))
        async def collect():
            return [event async for event in strategy.strategy_events('Alice')]
        with patch.object(strategy,'evidence_count',return_value=3), \
             patch.object(strategy,'factual_statistics',return_value=(stats,['g1','g2','g3'],'v1')), \
             patch.object(strategy,'supporting_games',return_value=[{'id':'g1'}]), \
             patch.object(strategy,'report_chain',return_value=chain), \
             patch.object(strategy,'report_cache',side_effect=ConnectionError()), \
             patch.dict(strategy.os.environ,{'GOOGLE_API_KEY':'test'}):
            events = asyncio.run(collect())
        self.assertEqual(events[1]['type'],'statistics')
        self.assertEqual(events[-1]['type'],'complete')
        self.assertFalse(events[-1]['result']['cached'])

    def test_cache_hit_skips_retrieval_and_generation(self):
        cached = {'cached':True}
        with patch.object(strategy,'evidence_count',return_value=3), \
             patch.object(strategy,'factual_statistics',return_value=([],['g1','g2','g3'],'v1')), \
             patch.object(strategy,'cache_read',return_value=cached), \
             patch.object(strategy,'supporting_games') as retrieve:
            self.assertEqual(strategy.generate_chess_prediction('Alice'),cached)
            retrieve.assert_not_called()

    def test_native_schema_is_bound_to_model(self):
        with patch.object(strategy.httpx,'Client') as client, patch.dict(strategy.os.environ,{'GOOGLE_API_KEY':'test'}):
            response = client.return_value.post.return_value
            response.json.return_value = {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':report().model_dump_json()}]}}]}
            strategy.GeminiReportClient('test-model').invoke('evidence')
            config = client.return_value.post.call_args.kwargs['json']['generationConfig']
            self.assertEqual(config['responseMimeType'],'application/json')
            self.assertIn('recommendations',config['responseSchema']['properties'])

    def test_provider_failure_is_explicit(self):
        with patch.object(strategy.httpx,'Client') as client, patch.dict(strategy.os.environ,{'GOOGLE_API_KEY':'test'}):
            client.return_value.post.side_effect = strategy.httpx.ReadTimeout('slow provider')
            with self.assertRaises(strategy.StrategyProviderUnavailable):
                strategy.GeminiReportClient('test-model').invoke('evidence')


if __name__ == '__main__': unittest.main()
