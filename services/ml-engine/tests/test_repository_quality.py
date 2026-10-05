import asyncio
import io
import os
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch
from uuid import uuid4

import chess
import chess.pgn
from fastapi import HTTPException
import main
import migrate
import predict_opponent as reports
from prepare_country_dataset import prepare
from build_country_roster import build
from database import connect
from evaluate_predictions import evaluate, partition_games


class RepositoryQualityTests(unittest.TestCase):
    def test_reference_endpoint_requires_authentication_and_bounded_pagination(self):
        import httpx
        async def exercise():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),base_url='http://test') as client:
                query = {'player':'Alice','statistic_id':'sample','version':'v1'}
                missing = await client.get('/api/v1/evidence/references',params=query)
                self.assertEqual(missing.status_code,401)
                main.app.dependency_overrides[main.evidence_user] = lambda: {'sub':'references-test'}
                try:
                    with patch.object(reports,'reference_page',return_value={
                            'games':[{'id':'g1','white':'Alice','black':'Bob'}], 'total':1000,
                            'offset':0,'limit':50,'data_version':'v1'}) as fetch:
                        invalid = await client.get('/api/v1/evidence/references',params={**query,'limit':101})
                        self.assertEqual(invalid.status_code,422); fetch.assert_not_called()
                        valid = await client.get('/api/v1/evidence/references',params=query)
                        self.assertEqual(valid.status_code,200)
                        self.assertEqual(valid.json()['total'],1000)
                    with patch.object(reports,'reference_page',side_effect=ValueError('Evidence changed')):
                        stale = await client.get('/api/v1/evidence/references',params=query)
                        self.assertEqual(stale.status_code,409)
                finally:
                    main.app.dependency_overrides.clear()
        asyncio.run(exercise())

    def test_country_import_uses_fide_identity_not_tournament_location(self):
        import json
        from pathlib import Path
        import zipfile
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            xml = '<playerslist><player><fideid>123</fideid><name>Alice</name><country>SRI</country></player><player><fideid>999</fideid><name>Bob</name><country>USA</country></player></playerslist>'
            archive = folder/'fide.zip'
            with zipfile.ZipFile(archive,'w') as zipped: zipped.writestr('players.xml',xml)
            roster = folder/'roster.json'; self.assertEqual(build(archive,roster),1)
            valid = '[White "Alice"]\n[Black "Bob"]\n[WhiteFideId "123"]\n[BlackFideId "999"]\n\n1. e4 e5 *'
            foreign = '[White "Visitor"]\n[Black "Bob"]\n[EventCountry "SRI"]\n\n1. d4 d5 *'
            source = folder/'games.pgn'; source.write_text(valid+'\n\n'+valid+'\n\n'+foreign,encoding='utf8')
            output = folder/'prepared.pgn'
            result = prepare([source],roster,output)
            self.assertEqual(result['totals']['included'],1)
            self.assertEqual(result['totals']['duplicates'],1)
            self.assertEqual(result['totals']['without_confirmed_country'],1)
            self.assertEqual(result['players'][0]['games'],1)
            with self.assertRaises(FileExistsError): prepare([source],roster,output)

    def test_move_failures_do_not_expose_internal_exceptions(self):
        with patch.object(main, 'data_version', return_value=1), patch.object(main, 'redis_client', None), \
             patch.object(main, 'score_legal_moves', side_effect=RuntimeError('private-password-database-host')):
            with self.assertRaises(HTTPException) as failure:
                asyncio.run(main.predict_move(main.MovePredictionRequest(fen=chess.STARTING_FEN), {}))
        self.assertEqual(failure.exception.status_code, 500)
        self.assertNotIn('private-password', failure.exception.detail)
        self.assertIn('X-Request-ID', failure.exception.headers)

    def test_statistics_bound_reference_samples_without_changing_counts(self):
        ids = [f'g{i:05}' for i in range(10000)]
        db = Mock()
        db.execute.side_effect = [Mock(fetchall=lambda: [(item,) for item in ids]),
            Mock(fetchall=lambda: [('white', '1-0', 10000, ids)]),
            Mock(fetchall=lambda: [('e4 e5', 10000, ids)]), Mock(fetchall=lambda: [])]
        @contextmanager
        def connection():
            yield db
        with patch.object(reports, 'connect', connection):
            stats, complete_ids, _ = reports.factual_statistics('alice')
        self.assertEqual(len(complete_ids), 10000)
        for stat in stats:
            self.assertEqual(stat['games'], 10000)
            self.assertEqual(len(stat['game_ids']), 6)

    def test_reference_pages_reject_a_stale_report_version(self):
        with patch.object(reports, 'cached_statistics', return_value=([], [], 'new')), \
             patch.object(reports, 'connect') as connection:
            with self.assertRaises(ValueError):
                reports.reference_page('alice', 'any', 'sample', 'old', 0, 25)
        connection.assert_not_called()

    def test_dates_are_disjoint_and_undated_games_are_excluded(self):
        games = {}
        for index, day in enumerate(['2020.01.01', '2020.01.01', '2021.01.01', '2022.01.01', '????.??.??']):
            game = chess.pgn.Game(); game.headers['Date'] = day; games[str(index)] = game
        groups, excluded = partition_games(games, 'chronological')
        self.assertEqual(excluded, 1)
        self.assertEqual(len(groups['train']), 2)
        self.assertLess(max(g.headers['Date'] for g in groups['train']), min(g.headers['Date'] for g in groups['validation']))
        self.assertLess(max(g.headers['Date'] for g in groups['validation']), min(g.headers['Date'] for g in groups['test']))

    def test_evaluation_tunes_on_validation_and_deduplicates_games(self):
        games = ['[Date "2020.01.01"]\n[White "Alice"]\n\n1. e4 e5 *',
                 '[Date "2021.01.01"]\n[White "Alice"]\n\n1. d4 d5 *',
                 '[Date "2022.01.01"]\n[White "Alice"]\n\n1. c4 e5 *']
        with tempfile.NamedTemporaryFile(mode='w', suffix='.pgn', encoding='utf8') as source:
            source.write('\n\n'.join(games + games[:1])); source.flush()
            result = evaluate(source.name)
        self.assertEqual(result['unique_games'], 3)
        self.assertEqual(result['split_games'], {'train':1,'validation':1,'test':1})
        self.assertEqual(result['tuning']['validation_positions'], 2)
        self.assertEqual(result['metrics']['overall']['positions'], 2)
        self.assertIn(result['prior_strength'], [5,10,20,40,80])

    @unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS') == '1', 'Requires PostgreSQL')
    def test_fresh_and_existing_schema_migrations_are_idempotent_and_transactional(self):
        class Rollback(Exception): pass
        with self.assertRaises(Rollback):
            with connect() as db:
                schema = 'migration_test_' + uuid4().hex
                db.execute(f'CREATE SCHEMA {schema}')
                db.execute(f'SET LOCAL search_path TO {schema}')
                migrate.apply(db)
                db.execute("INSERT INTO ingested_games(id,white,black) VALUES ('keep','Alice','Bob')")
                migrate.apply(db)
                migrate.check_schema(db)
                self.assertEqual(db.execute('SELECT count(*) FROM schema_migrations').fetchone()[0], len(migrate.definitions()))
                self.assertEqual(db.execute('SELECT count(*) FROM ingested_games').fetchone()[0], 1)
                db.execute("UPDATE schema_migrations SET checksum='tampered' WHERE version='0001_platform'")
                with self.assertRaises(RuntimeError): migrate.apply(db)
                raise Rollback()
