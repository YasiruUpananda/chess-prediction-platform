import os
import unittest
from unittest.mock import Mock
from database import connect, close_pool
from vector_search import search


@unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS') == '1', 'requires local PostgreSQL')
class VectorSearchTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls): close_pool()

    def test_exact_fallback_preserves_owner_player_filter(self):
        with connect() as db:
            row = db.execute("SELECT embedding::text,cmetadata FROM langchain_pg_embedding "
                             "WHERE cmetadata ? 'game_id' LIMIT 1").fetchone()
        self.assertIsNotNone(row)
        import json
        vector, metadata = json.loads(row[0]), row[1]
        store = Mock()
        store.embeddings.embed_query.return_value = vector
        docs = search(store, 'test', metadata['white_normalized'], [metadata['game_id']])
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].metadata['game_id'], metadata['game_id'])
        self.assertEqual(search(store, 'test', 'not-the-selected-player', [metadata['game_id']]), [])

    def test_dimension_guard(self):
        store = Mock()
        store.embeddings.embed_query.return_value = [1, 2]
        with self.assertRaises(ValueError): search(store, 'test', 'player', ['game'])
