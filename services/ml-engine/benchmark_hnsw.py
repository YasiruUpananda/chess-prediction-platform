"""Compare filtered HNSW with exact search on disposable synthetic vectors."""
import json
import statistics
import time
from database import connect, close_pool


def benchmark(rows=5000):
    results = {}
    with connect() as db:
        db.execute('CREATE TEMP TABLE vector_benchmark (id int, player int, embedding vector(384))')
        db.execute('INSERT INTO vector_benchmark SELECT g, g %% 25, '
                   'ARRAY(SELECT (random()+g*0)::real FROM generate_series(1,384))::vector '
                   'FROM generate_series(1,%s) g', (rows,))
        db.execute('CREATE INDEX ON vector_benchmark USING hnsw (embedding vector_cosine_ops)')
        db.execute('ANALYZE vector_benchmark')
        query = 'SELECT id FROM vector_benchmark WHERE player=%s ORDER BY embedding <=> %s::vector LIMIT 6'
        vectors = db.execute('SELECT player,embedding::text FROM vector_benchmark LIMIT 10').fetchall()
        exact = []
        for mode in ('exact', 'hnsw'):
            db.execute('SET LOCAL enable_indexscan=' + ('off' if mode == 'exact' else 'on'))
            db.execute('SET LOCAL enable_seqscan=' + ('on' if mode == 'exact' else 'off'))
            db.execute("SET LOCAL hnsw.ef_search=100")
            db.execute("SET LOCAL hnsw.iterative_scan='strict_order'")
            durations, recalls = [], []
            for index, params in enumerate(vectors):
                start = time.perf_counter()
                found = [r[0] for r in db.execute(query, params).fetchall()]
                durations.append((time.perf_counter()-start)*1000)
                if mode == 'exact': exact.append(found)
                else: recalls.append(len(set(found) & set(exact[index])) / len(exact[index]))
            results[mode] = {'median_ms': round(statistics.median(durations), 3)}
            if recalls: results[mode]['mean_recall_at_6'] = round(statistics.mean(recalls), 4)
        # The table and index disappear when this transaction is rolled back.
        db.rollback()
    return {'synthetic_rows': rows, 'player_groups': 25, 'queries': 10, 'results': results}


if __name__ == '__main__':
    try: print(json.dumps(benchmark(), indent=2))
    finally: close_pool()
