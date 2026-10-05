import unittest
import io
import chess.pgn
import os
from unittest.mock import patch
from game_identity import game_identity
class IdentityTests(unittest.TestCase):
    def test_annotations_export_metadata_and_alias_case_do_not_duplicate_game(self):
        game=chess.pgn.read_game(io.StringIO('[White "Alice"]\n[Black "Bob"]\n\n1.e4 e5 *'))
        original=game_identity(game)
        game.headers['Annotator']='New editor';game.headers['Source']='Another export';game.headers['White']=' ALICE '
        self.assertEqual(original,game_identity(game))
        game.headers['Date']='2020.01.01';self.assertNotEqual(original,game_identity(game))
    def test_fide_identity_survives_name_alias_and_distinguishes_namesakes(self):
        game=chess.pgn.read_game(io.StringIO('1.e4 e5 *'));game.headers['WhiteFideId']='123'
        original=game_identity(game);game.headers['White']='Alias';self.assertEqual(original,game_identity(game))
        game.headers['WhiteFideId']='456';self.assertNotEqual(original,game_identity(game))

    def test_statistics_cache_is_reused_and_invalidated_by_dataset_version(self):
        import predict_opponent as reports
        reports._stat_cache.clear()
        with patch.object(reports,'data_version',return_value=1) as version,patch.object(reports,'factual_statistics',return_value=([],['g1'],'v1')) as compute:
            reports.cached_statistics('test');reports.cached_statistics('test');self.assertEqual(compute.call_count,1)
            version.return_value=2;reports.cached_statistics('test');self.assertEqual(compute.call_count,2)
        reports._stat_cache.clear()

    @unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS')=='1','Requires OCR integration corpus')
    def test_scanned_fixture_recovers_complete_legal_line(self):
        from pathlib import Path
        from ocr_worker import run_extract
        source=Path('/pdfcorpus/scan.pdf')
        self.assertTrue(source.exists(),'The committed scanned corpus must be mounted')
        result=run_extract(1,source.read_bytes())
        text=result['text'].replace('0-0','O-O')
        game=chess.pgn.read_game(io.StringIO(text))
        self.assertIsNotNone(game);self.assertFalse(game.errors)
        board=game.board();moves=[]
        for move in game.mainline_moves():moves.append(board.san(move));board.push(move)
        self.assertEqual(moves,['e4','e5','Nf3','Nc6','Bb5','a6'])

    @unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS')=='1','Requires provisioned PostgreSQL roles')
    def test_runtime_roles_cannot_create_schema_or_modify_migration_ledger(self):
        from database import connect
        import psycopg
        from psycopg import sql
        with connect() as db:
            for role in ['neuro_api','neuro_ingestion','neuro_ocr','neuro_backup']:
                db.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                self.assertEqual(db.execute("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user").fetchone(),(False,False,False))
                self.assertFalse(db.execute("SELECT has_schema_privilege(current_user,'public','CREATE')").fetchone()[0])
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with db.transaction():db.execute("UPDATE schema_migrations SET checksum='tamper'")
                db.execute('RESET ROLE')

    @unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS')=='1','Requires migration integration')
    def test_identity_backfill_retains_references_and_excludes_metadata_duplicates(self):
        from database import connect
        from migrate import backfill_games
        from uuid import uuid4
        class Rollback(Exception): pass
        prefix='__identity_'+uuid4().hex
        text=f'[White "{prefix}"]\n[Black "Other"]\n\n1.e4 e5 *'
        with self.assertRaises(Rollback):
            with connect() as db:
                collection=db.execute("SELECT uuid FROM langchain_pg_collection WHERE name='chess_games_vector'").fetchone()[0]
                for suffix in ['a','b']:
                    identity=prefix+suffix
                    db.execute('INSERT INTO ingested_games(id,white,black,indexed) VALUES (%s,%s,%s,true)',(identity,prefix,'Other'))
                    db.execute('INSERT INTO langchain_pg_embedding(id,collection_id,document) VALUES (%s,%s,%s)',(identity,collection,text if suffix=='a' else '[Annotator "Other"]\n'+text))
                backfill_games(db)
                rows=db.execute('SELECT id,indexed,duplicate_of,canonical_id FROM ingested_games WHERE id=ANY(%s) ORDER BY id',([prefix+'a',prefix+'b'],)).fetchall()
                self.assertTrue(rows[0][1]);self.assertFalse(rows[1][1]);self.assertEqual(rows[1][2],rows[0][0]);self.assertEqual(rows[0][3],rows[1][3])
                raise Rollback()
