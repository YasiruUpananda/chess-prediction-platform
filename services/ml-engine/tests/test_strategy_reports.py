import asyncio
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from pydantic import ValidationError
import predict_opponent as strategy


def report(reference='g1'):
    claim = {'text':'Observed evidence', 'confidence':'tentative', 'source_game_ids':[reference], 'statistic_ids':[]}
    return strategy.StrategyReport(profile=[claim], tendencies=[], weaknesses=[], recommendations=[], limitations=['Small sample'])


class StrategyTests(unittest.TestCase):
    def test_numerical_model_claims_cannot_masquerade_as_verified_statistics(self):
        for text in ['Won 99 games','Won ninety percent of games','Won three games']:
            claim={'text':text,'confidence':'supported','source_game_ids':[],'statistic_ids':['sample']}
            result=strategy.StrategyReport(profile=[claim],tendencies=[],weaknesses=[],recommendations=[],limitations=['Small sample'])
            with self.assertRaisesRegex(ValueError,'Numerical claims'):
                strategy.validate_report(result,[],[{'id':'sample','games':3}])

    def test_cancelled_thread_retains_capacity_until_underlying_work_finishes(self):
        started=threading.Event();release=threading.Event();finished=threading.Event()
        slots=threading.BoundedSemaphore(1)
        def evidence(_player):
            started.set();release.wait(3);finished.set();return 3
        async def check():
            async def consume():
                async for _event in strategy.strategy_events('Alice'): pass
            task=asyncio.create_task(consume())
            while not started.is_set(): await asyncio.sleep(.005)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
            self.assertFalse(slots.acquire(blocking=False))
            release.set()
            for _ in range(100):
                if finished.is_set() and slots.acquire(blocking=False):
                    slots.release();return
                await asyncio.sleep(.005)
            self.fail('Capacity was not released after the worker finished')
        try:
            with patch.object(strategy,'REPORT_SLOTS',slots),patch.object(strategy,'evidence_count',side_effect=evidence):
                asyncio.run(check())
        finally: release.set()

    def test_async_provider_request_closes_on_cancellation(self):
        async def check():
            started=asyncio.Event()
            async def slow_post(*_args,**_kwargs):
                started.set();await asyncio.sleep(30)
            client=AsyncMock();client.post.side_effect=slow_post
            manager=AsyncMock();manager.__aenter__.return_value=client
            with patch.object(strategy.httpx,'AsyncClient',return_value=manager),patch.dict(strategy.os.environ,{'GOOGLE_API_KEY':'fixture'}):
                task=asyncio.create_task(strategy.GeminiReportClient('test-model').ainvoke('evidence'))
                await started.wait();task.cancel()
                with self.assertRaises(asyncio.CancelledError):await task
                manager.__aexit__.assert_awaited_once()
        asyncio.run(check())

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
