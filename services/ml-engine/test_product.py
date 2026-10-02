import os
import time
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from fastapi import HTTPException
import chess
import main
import studies
from database import init_db, connect
from test_auth_fixture import signed_sessions


@unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS') == '1','requires local PostgreSQL')
class ProductTests(unittest.TestCase):
    def test_concurrent_study_cap(self):
        init_db()
        owner=f'study-cap-{uuid4()}'
        body=studies.StudyInput(title='Opening',fen=chess.STARTING_FEN,initial_fen=chess.STARTING_FEN,moves=[])
        from psycopg.types.json import Jsonb
        from concurrent.futures import ThreadPoolExecutor
        try:
            with connect() as db:
                for _ in range(99):
                    db.execute('INSERT INTO saved_studies(id,owner,title,snapshot) VALUES (%s,%s,%s,%s)',
                               (uuid4(),owner,'Opening',Jsonb(body.model_dump())))
            def save():
                try: studies.save_study(body,{'sub':owner}); return 201
                except HTTPException as error: return error.status_code
            with ThreadPoolExecutor(max_workers=2) as pool:
                statuses=list(pool.map(lambda _index:save(),range(2)))
            self.assertEqual(sorted(statuses),[201,409])
        finally:
            with connect() as db: db.execute('DELETE FROM saved_studies WHERE owner=%s',(owner,))

    def test_signed_auth_and_private_study_roundtrip(self):
        init_db()
        owner, other = f'study-test-{uuid4()}', f'study-test-{uuid4()}'
        client = TestClient(main.app)
        with signed_sessions() as token:
            headers={'Authorization':'Bearer '+token(owner)}
            board=chess.Board(); board.push_uci('e2e4')
            body={'title':'Opening','fen':board.fen(),'initial_fen':chess.STARTING_FEN,'moves':['e2e4'],
                  'opponent_name':'Player','context':'Prepare a line','color':'black'}
            try:
                self.assertEqual(client.get('/api/v1/studies').status_code,401)
                self.assertEqual(client.get('/api/v1/studies',headers={'Authorization':'Bearer '+token(owner,exp=int(time.time())-60)}).status_code,401)
                self.assertEqual(client.get('/api/v1/studies',headers={'Authorization':'Bearer '+token(owner,aud='wrong')}).status_code,401)
                self.assertEqual(client.post('/api/v1/studies',headers=headers,json={**body,'moves':[]}).status_code,400)
                result=client.post('/api/v1/studies',headers=headers,json=body)
                self.assertEqual(result.status_code,201,result.text)
                study_id=result.json()['id']
                private_headers={'Authorization':'Bearer '+token(other)}
                self.assertEqual(client.get('/api/v1/studies',headers=private_headers).json()['studies'],[])
                self.assertEqual(client.delete('/api/v1/studies/'+study_id,headers=private_headers).status_code,404)
                saved=client.get('/api/v1/studies',headers=headers).json()['studies'][0]
                self.assertEqual(saved['moves'],['e2e4'])
                self.assertEqual(client.delete('/api/v1/studies/'+study_id,headers=headers).status_code,204)
            finally:
                with connect() as db:
                    db.execute('DELETE FROM saved_studies WHERE owner=ANY(%s)',([owner,other],))
