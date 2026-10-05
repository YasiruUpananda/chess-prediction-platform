"""Non-destructive checks against running PostgreSQL; all test rows are rolled back or removed."""
import hashlib
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from psycopg_pool import PoolTimeout
from unittest.mock import patch
from fastapi import HTTPException
from database import connect, data_version, get_pool
import operations


@unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS')=='1','Integration checks require running PostgreSQL')
class BackendIntegrationTests(unittest.TestCase):
    def test_pool_exhaustion_has_a_bounded_checkout_deadline(self):
        pool=get_pool()
        with ExitStack() as stack:
            for _ in range(pool.max_size): stack.enter_context(pool.connection())
            with self.assertRaises(PoolTimeout):
                with pool.connection(timeout=0.05): pass

    def test_pool_reuses_connections_and_rolls_back_transactions(self):
        pids=set()
        for _ in range(20):
            with connect() as db: pids.add(db.execute('SELECT pg_backend_pid()').fetchone()[0])
        self.assertLessEqual(len(pids),get_pool().max_size)
        game='__test_pool_'+uuid.uuid4().hex
        with self.assertRaises(RuntimeError):
            with connect() as db:
                db.execute("INSERT INTO ingested_games(id,white,black) VALUES (%s,'Test','Test')",(game,))
                raise RuntimeError('rollback test')
        with connect() as db: self.assertEqual(db.execute('SELECT count(*) FROM ingested_games WHERE id=%s',(game,)).fetchone()[0],0)

    def test_indexed_data_changes_version_in_the_same_transaction(self):
        with self.assertRaises(RuntimeError):
            with connect() as db:
                before=db.execute('SELECT version FROM dataset_version WHERE id=1').fetchone()[0]
                game='__test_version_'+uuid.uuid4().hex
                db.execute("INSERT INTO ingested_games(id,white,black) VALUES (%s,'Test','Test')",(game,))
                inserted=db.execute('SELECT version FROM dataset_version WHERE id=1').fetchone()[0]
                db.execute("INSERT INTO ingested_games(id,white,black) VALUES (%s,'Test','Test') ON CONFLICT DO NOTHING",(game,))
                self.assertEqual(db.execute('SELECT version FROM dataset_version WHERE id=1').fetchone()[0],inserted)
                db.execute('UPDATE ingested_games SET indexed=true WHERE id=%s',(game,))
                after=db.execute('SELECT version FROM dataset_version WHERE id=1').fetchone()[0]
                self.assertGreater(after,before)
                raise RuntimeError('rollback test')

    def test_concurrent_admission_is_bounded_and_user_scoped(self):
        subject='__test_rate_'+uuid.uuid4().hex
        owners=[hashlib.sha256(name.encode()).hexdigest() for name in (subject,subject+'-other')]
        def attempt(_):
            try: operations.admit({'sub':subject},'reports',5); return True
            except HTTPException as error:
                self.assertEqual(error.status_code,429); return False
        try:
            with patch.dict(os.environ,{'RATE_REPORTS_PER_MINUTE':'5'}):
                with ThreadPoolExecutor(max_workers=8) as executor:
                    allowed=list(executor.map(attempt,range(20)))
                self.assertEqual(sum(allowed),5)
                operations.admit({'sub':subject+'-other'},'reports',5)
                with connect() as db:
                    db.execute('UPDATE request_limits SET window_id=window_id-1 WHERE owner=%s',(owners[0],))
                operations.admit({'sub':subject},'reports',5)
        finally:
            with connect() as db: db.execute('DELETE FROM request_limits WHERE owner=ANY(%s)',(owners,))

if __name__=='__main__': unittest.main()
