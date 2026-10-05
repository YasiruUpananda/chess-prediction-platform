import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch
from contextlib import contextmanager
import chess
import httpx
from fastapi import HTTPException
import main
import operations
import backend_health


class BackendEfficiencyTests(unittest.TestCase):
    def test_ordinary_token_cannot_enqueue_ingestion(self):
        async def check():
            main.app.dependency_overrides[main.require_asgardeo_user] = lambda: {'sub':'ordinary-test','scope':'openid profile'}
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),base_url='http://test') as client:
                    return await client.post('/api/v1/ingest-async',json={'filename':'tournament.pgn'})
            finally:
                main.app.dependency_overrides.clear()
        with patch.object(main,'enqueue') as queue:
            response=asyncio.run(check())
        self.assertEqual(response.status_code,403)
        queue.assert_not_called()

    def test_dataset_version_invalidates_move_cache(self):
        keys=[]
        cache=Mock(get=AsyncMock(side_effect=lambda key: keys.append(key)),setex=AsyncMock())
        with patch.object(main,'redis_client',cache), patch.object(main,'data_version',side_effect=[1,2]), \
             patch.object(main,'find_historical_move_counts',return_value={}), \
             patch.object(main.engine_pool,'analyse',return_value={'status':'available'}):
            for _ in range(2):
                asyncio.run(main.predict_move(main.MovePredictionRequest(fen=chess.STARTING_FEN),{}))
        self.assertEqual(len(keys),2)
        self.assertNotEqual(keys[0],keys[1])

    def test_database_version_outage_never_serves_stale_cache(self):
        cache=Mock(get=AsyncMock(),setex=AsyncMock())
        with patch.object(main,'redis_client',cache), patch.object(main,'data_version',side_effect=ConnectionError()), \
             patch.object(main,'find_historical_move_counts',return_value={}), \
             patch.object(main.engine_pool,'analyse',return_value={'status':'available'}):
            asyncio.run(main.predict_move(main.MovePredictionRequest(fen=chess.STARTING_FEN),{}))
        cache.get.assert_not_called(); cache.setex.assert_not_called()

    def test_ingestion_requires_explicit_authorization(self):
        with patch.dict('os.environ',{'INGEST_REQUIRED_SCOPE':'chess:ingest','INGEST_REQUIRED_ROLE':'ingestion-admin'}), \
             patch.object(operations,'admit',side_effect=lambda user,*args:user):
            for user in [{'sub':'a','scope':'openid profile'}, {'sub':'a','roles':['ordinary-user']}]:
                with self.assertRaises(HTTPException) as error: operations.ingestion_user(user)
                self.assertEqual(error.exception.status_code,403)
            self.assertEqual(operations.ingestion_user({'sub':'a','scope':'openid chess:ingest'})['sub'],'a')
            self.assertEqual(operations.ingestion_user({'sub':'a','roles':['ingestion-admin']})['sub'],'a')

    def test_limits_return_retry_after_and_database_failures_fail_closed(self):
        @contextmanager
        def connection():
            db=Mock(); db.execute.side_effect=[Mock(fetchone=lambda:(100,)),Mock(fetchone=lambda:(7,)),Mock()]
            yield db
        with patch.object(operations,'connect',connection):
            with self.assertRaises(HTTPException) as error: operations.admit({'sub':'a'},'reports',6)
            self.assertEqual(error.exception.status_code,429)
            self.assertEqual(error.exception.headers['Retry-After'],'60')
        with patch.object(operations,'connect',side_effect=ConnectionError()):
            with self.assertRaises(HTTPException) as error: operations.admit({'sub':'a'},'reports',6)
            self.assertEqual(error.exception.status_code,503)

    def test_readiness_requires_workers_and_database(self):
        @contextmanager
        def connection():
            db=Mock(); db.execute.side_effect=[Mock(fetchall=lambda:[('ingestion',True),('ocr',False)]),Mock(fetchone=lambda:(188,))]
            yield db
        with patch.object(backend_health,'connect',connection):
            ready,details=backend_health.readiness()
        self.assertFalse(ready); self.assertTrue(details['database']); self.assertFalse(details['ocr'])
        with patch.object(backend_health,'connect',side_effect=ConnectionError()):
            self.assertFalse(backend_health.readiness()[0])

if __name__=='__main__': unittest.main()
