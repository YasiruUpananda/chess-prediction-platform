import os
import unittest
from unittest.mock import Mock, patch
from contextlib import contextmanager
import json
from uuid import uuid4
from database import connect, close_pool
from vector_search import search


@unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS') == '1', 'requires local PostgreSQL')
class VectorSearchTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls): close_pool()

    def test_exact_fallback_preserves_owner_player_filter(self):
        with connect() as db:
            # Temporary fixtures shadow production tables only on this connection.
            # This test must work on an empty CI database without real player data.
            db.execute('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public')
            db.execute('CREATE TEMP TABLE langchain_pg_collection (uuid UUID PRIMARY KEY,name TEXT) ON COMMIT DROP')
            db.execute('CREATE TEMP TABLE langchain_pg_embedding (collection_id UUID,document TEXT,cmetadata JSONB,embedding vector(384)) ON COMMIT DROP')
            from rag_store import COLLECTION_NAME
            collection = uuid4(); vector = [1.0] + [0.0]*383
            metadata = {'game_id':str(uuid4()),'white_normalized':'fixture-alice','black_normalized':'fixture-bob'}
            db.execute('INSERT INTO langchain_pg_collection VALUES (%s,%s)',(collection,COLLECTION_NAME))
            db.execute('INSERT INTO langchain_pg_embedding VALUES (%s,%s,%s::jsonb,%s::vector)',
                       (collection,'1. e4 e5 *',json.dumps(metadata),json.dumps(vector)))
            @contextmanager
            def connection(): yield db
            store = Mock(); store.embeddings.embed_query.return_value = vector
            with patch('vector_search.connect',connection):
                docs = search(store,'test','fixture-alice',[metadata['game_id']])
                self.assertEqual(len(docs),1)
                self.assertEqual(docs[0].metadata['game_id'],metadata['game_id'])
                self.assertEqual(search(store,'test','not-the-selected-player',[metadata['game_id']]),[])

    def test_dimension_guard(self):
        store = Mock()
        store.embeddings.embed_query.return_value = [1, 2]
        with self.assertRaises(ValueError): search(store, 'test', 'player', ['game'])
