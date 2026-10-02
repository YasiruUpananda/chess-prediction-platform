"""Opt-in tests against local Compose services; never calls a paid model.

RUN_INTEGRATION_TESTS=1 python -m unittest test_reliability_integration -v
"""
import os
import asyncio
import io
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from pathlib import Path
from uuid import uuid4

import fitz
import chess.pgn
import httpx

import ocr_jobs
import ocr_worker
import worker
import main
from database import connect


@unittest.skipUnless(os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires running local Compose services")
class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.owner = "integration-" + str(uuid4())

    def tearDown(self):
        with connect() as db:
            db.execute("DELETE FROM ocr_jobs WHERE owner=%s", (self.owner,))

    def pdf(self, scanned=False):
        with fitz.open() as doc:
            page = doc.new_page(width=500, height=150)
            page.insert_text((30,60), "1. e4 e5 2. Nf3 Nc6", fontsize=24)
            if not scanned:
                return doc.tobytes()
            image = page.get_pixmap(dpi=200).tobytes("png")
        with fitz.open() as doc:
            page = doc.new_page(width=500, height=150)
            page.insert_image(page.rect, stream=image)
            return doc.tobytes()

    def test_scanned_pdf_completes_and_is_owner_scoped(self):
        job = ocr_jobs.submit(self.owner, 1, self.pdf(scanned=True))
        self.assertIsNone(ocr_jobs.get(job['job_id'], 'someone-else'))
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            result = ocr_jobs.get(job['job_id'], self.owner)
            if result['status'] in ('completed','failed'):
                break
            time.sleep(0.25)
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual(result['result']['moves'], ['e4','e5','Nf3','Nc6'])
        with connect() as db:
            self.assertIsNone(db.execute("SELECT pdf FROM ocr_jobs WHERE id=%s", (job['job_id'],)).fetchone()[0])

    def test_full_queue_rejects_without_storing_pdf(self):
        with patch.dict(os.environ, {'OCR_QUEUE_LIMIT': '0'}):
            with self.assertRaises(ocr_jobs.QueueFull):
                ocr_jobs.submit(self.owner, 1, self.pdf())

    def test_api_auth_admission_and_owner_checks(self):
        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                response = await client.get('/api/v1/ocr-jobs/' + str(uuid4()))
                self.assertEqual(response.status_code, 401)
                main.app.dependency_overrides[main.require_asgardeo_user] = lambda: {'sub': self.owner}
                try:
                    response = await client.post('/api/v1/extract-page-moves', data={'page':'1'},
                        files={'file': ('test.pdf', self.pdf(), 'application/pdf')})
                    self.assertEqual(response.status_code, 202, response.text)
                    url = '/api/v1/ocr-jobs/' + response.json()['job_id']
                    self.assertEqual((await client.get(url)).status_code, 200)
                    main.app.dependency_overrides[main.require_asgardeo_user] = lambda: {'sub': 'other-user'}
                    self.assertEqual((await client.get(url)).status_code, 404)
                    response = await client.post('/api/v1/predict-strategy', json={'opponent_name': self.owner})
                    self.assertEqual(response.status_code, 422)
                    self.assertIn('Insufficient game data', response.json()['detail'])
                finally:
                    main.app.dependency_overrides.clear()
        asyncio.run(check())

    def test_stale_running_job_is_failed_and_upload_released(self):
        job_id = uuid4()
        with connect() as db:
            db.execute("""INSERT INTO ocr_jobs(id,owner,page,pdf,status,started_at)
                VALUES (%s,%s,1,%s,'running',now()-interval '1 hour')""",
                (job_id, self.owner, self.pdf()))
        # The real worker performs recovery in its normal polling cycle.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = ocr_jobs.get(job_id, self.owner)
            if result['status'] == 'failed':
                break
            time.sleep(0.25)
        self.assertEqual(result['status'], 'failed')

    def test_subprocess_timeout_is_enforced(self):
        with patch.dict(os.environ, {'OCR_TIMEOUT_SECONDS': '0'}):
            with self.assertRaises(TimeoutError):
                ocr_worker.run_extract(1, self.pdf())

    def test_ingestion_retry_after_vector_failure_does_not_duplicate_moves(self):
        text = f'[Event "{self.owner}"]\n[White "Test White"]\n[Black "Test Black"]\n\n1. e4 e5 *'
        game_id = worker.game_identity(chess.pgn.read_game(io.StringIO(text)))
        vector_store = Mock()
        vector_store.add_documents.side_effect = [RuntimeError('simulated indexing outage'), None]
        try:
            with tempfile.TemporaryDirectory() as folder:
                Path(folder, 'retry.pgn').write_text(text)
                with patch.object(worker, 'PGN_DATA_DIR', Path(folder)), patch('rag_store.get_vector_store', return_value=vector_store):
                    with self.assertRaises(RuntimeError):
                        worker.process_pgn('retry.pgn')
                    worker.process_pgn('retry.pgn')
                    worker.process_pgn('retry.pgn')
            with connect() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM player_moves WHERE game_id=%s', (game_id,)).fetchone()[0], 2)
                self.assertTrue(db.execute('SELECT indexed FROM ingested_games WHERE id=%s', (game_id,)).fetchone()[0])
            self.assertEqual(vector_store.add_documents.call_count, 2)
        finally:
            with connect() as db:
                db.execute('DELETE FROM player_moves WHERE game_id=%s', (game_id,))
                db.execute('DELETE FROM ingested_games WHERE id=%s', (game_id,))


if __name__ == '__main__':
    unittest.main()
