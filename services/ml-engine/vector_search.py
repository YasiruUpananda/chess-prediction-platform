"""Filtered HNSW retrieval with an exact fallback for restrictive player filters."""
import json
from langchain_core.documents import Document
from database import connect
from rag_store import COLLECTION_NAME
from telemetry import traced


@traced('retrieval.hnsw')
def search(store, query, player, ids, k=6):
    if not ids: return []
    vector = store.embeddings.embed_query(query)
    if len(vector) != 384:
        raise ValueError('HNSW search requires 384-dimensional embeddings')
    statement = '''SELECT e.document,e.cmetadata FROM langchain_pg_embedding e
        JOIN langchain_pg_collection c ON c.uuid=e.collection_id
        WHERE c.name=%s AND e.cmetadata->>'game_id'=ANY(%s)
        AND (e.cmetadata->>'white_normalized'=%s OR e.cmetadata->>'black_normalized'=%s)
        ORDER BY e.embedding::vector(384) <=> %s::vector(384) LIMIT %s'''
    params = (COLLECTION_NAME, ids, player, player, json.dumps(vector), k)
    with connect() as db:
        exists = db.execute("SELECT EXISTS(SELECT 1 FROM pg_index i WHERE "
            "i.indexrelid=to_regclass('idx_chess_embedding_hnsw_384') AND i.indisvalid)").fetchone()[0]
        if exists:
            db.execute("SET LOCAL hnsw.ef_search=100")
            db.execute("SET LOCAL hnsw.iterative_scan='strict_order'")
        else:
            db.execute('SET LOCAL enable_indexscan=off')
        rows = db.execute(statement, params).fetchall()
        if exists and len(rows) < min(k, len(ids)):
            db.execute('SET LOCAL enable_indexscan=off')
            rows = db.execute(statement, params).fetchall()
    return [Document(page_content=text, metadata=metadata) for text, metadata in rows]
