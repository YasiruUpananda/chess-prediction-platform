"""Read-only pool, positional-index and filtered vector-search benchmark."""
import json
import os
import statistics
import time
import psycopg
from database import connect, get_pool, close_pool
from rag_store import COLLECTION_NAME

def plan_summary(plan):
    node=plan['Plan']
    def nodes(item):
        return [{'type':item['Node Type'], 'actual_ms':item.get('Actual Total Time'),
                 'rows':item.get('Actual Rows'), 'index':item.get('Index Name')}] + [child for sub in item.get('Plans',[]) for child in nodes(sub)]
    return {'execution_ms':plan.get('Execution Time'), 'planning_ms':plan.get('Planning Time'), 'nodes':nodes(node)}


def measure(call, repeats=20):
    durations=[]
    for _ in range(repeats):
        start=time.perf_counter(); call(); durations.append((time.perf_counter()-start)*1000)
    return {'median_ms':round(statistics.median(durations),3), 'max_ms':round(max(durations),3)}


def main():
    def pooled():
        with connect() as db: db.execute('SELECT 1').fetchone()
    url=(os.getenv('WORKER_DATABASE_URL') or os.environ['DATABASE_URL']).replace('postgresql+psycopg://','postgresql://',1)
    def fresh():
        with psycopg.connect(url,connect_timeout=3) as db: db.execute('SELECT 1').fetchone()
    pooled()
    result={'fresh_connection':measure(fresh), 'pooled_connection':measure(pooled)}
    with connect() as db:
        result['indexed_games']=db.execute('SELECT count(*) FROM ingested_games WHERE indexed').fetchone()[0]
        result['moves']=db.execute('SELECT count(*) FROM player_moves').fetchone()[0]
        result['position_indexes']=[row[0] for row in db.execute("SELECT indexname FROM pg_indexes WHERE tablename='player_moves'").fetchall()]
        sample=db.execute('''SELECT e.embedding::text,e.cmetadata->>'white_normalized',e.collection_id::text
            FROM langchain_pg_embedding e JOIN langchain_pg_collection c ON c.uuid=e.collection_id
            WHERE c.name=%s LIMIT 1''',(COLLECTION_NAME,)).fetchone()
        result['vectors']=db.execute('''SELECT count(*) FROM langchain_pg_embedding e
            JOIN langchain_pg_collection c ON c.uuid=e.collection_id WHERE c.name=%s''',(COLLECTION_NAME,)).fetchone()[0]
    if sample:
        vector,player,collection=sample
        query='''SELECT id FROM langchain_pg_embedding WHERE collection_id=%s::uuid
            AND (cmetadata->>'white_normalized'=%s OR cmetadata->>'black_normalized'=%s)
            ORDER BY embedding <=> %s::vector LIMIT 3'''
        params=(collection,player,player,vector)
        def search():
            with connect() as db: db.execute(query,params).fetchall()
        result['filtered_vector_search']=measure(search)
        with connect() as db:
            result['vector_plan']=plan_summary(db.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,params).fetchone()[0][0])
        result['vector_index_decision']='Keep exact search at current volume; benchmark recall and filtered latency at larger scale before HNSW.'
    result['pool_stats']=get_pool().get_stats()
    print(json.dumps(result,indent=2))
    close_pool()

if __name__=='__main__': main()
