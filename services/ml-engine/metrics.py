"""Bounded, aggregate measurements with no user labels or raw URLs."""
import os
import secrets
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

API_LATENCY = Histogram('chess_api_duration_seconds', 'Full response duration', ['route','method','status'],
                        buckets=(.01,.025,.05,.1,.25,.5,1,2.5,5,10,30,60,90))
CACHE = Counter('chess_cache_requests', 'Cache outcomes', ['cache','outcome'])
OCR_QUEUE = Histogram('chess_ocr_queue_seconds', 'Time between enqueue and claim', buckets=(.1,.5,1,2,5,10,30,60,120,300,900))
OCR_PROCESS = Histogram('chess_ocr_processing_seconds', 'OCR processing time', buckets=(.1,.5,1,2,5,10,20,30,45,60))
JOBS = Counter('chess_jobs', 'Job attempt outcomes', ['kind','outcome'])
REPORT_FIRST = Histogram('chess_report_first_content_seconds', 'Time to first verified statistics', buckets=(.01,.05,.1,.25,.5,1,2,5,10,30,75))
REPORTS = Counter('chess_reports', 'Completed reports', ['cached'])
REPORT_FAILURES = Counter('chess_report_failures','Report failures or admission refusals',['reason'])
TOKENS = Counter('chess_gemini_tokens', 'Reported billable token counts', ['kind'])
COST = Counter('chess_report_estimated_cost_usd', 'Estimated provider cost; excludes unreported usage')
COST_UNKNOWN = Counter('chess_report_cost_unknown', 'Provider responses without a usable price or usage')
VITALS = Histogram('chess_browser_vital', 'One anonymous sample per metric/page lifecycle', ['name','route','device'],
                   buckets=(.001,.01,.05,.1,.2,.25,.5,1,2,2.5,4,10,30,60,200,600))
DATABASE_UP = Gauge('chess_database_up','Database reachable during scrape')
WORKER_AGE = Gauge('chess_worker_heartbeat_age_seconds','Time since last successful worker heartbeat',['worker'])
OCR_STATES = Gauge('chess_ocr_jobs','Current durable OCR job states',['status'])
INDEXED_GAMES = Gauge('chess_indexed_games','Successfully indexed games')


def refresh_operational():
    from database import connect
    try:
        with connect() as db:
            ages = dict(db.execute('SELECT name,EXTRACT(EPOCH FROM now()-seen_at) FROM service_heartbeats').fetchall())
            states = dict(db.execute('SELECT status,count(*) FROM ocr_jobs GROUP BY status').fetchall())
            games = db.execute('SELECT count(*) FROM ingested_games WHERE indexed').fetchone()[0]
        DATABASE_UP.set(1); INDEXED_GAMES.set(games)
        for name in ('ingestion','ocr'): WORKER_AGE.labels(name).set(float(ages.get(name,float('inf'))))
        for state in ('queued','running','failed','completed'): OCR_STATES.labels(state).set(states.get(state,0))
    except Exception:
        DATABASE_UP.set(0)
        for name in ('ingestion','ocr'): WORKER_AGE.labels(name).set(float('inf'))


def authorized(value):
    token = os.getenv('METRICS_TOKEN', '')
    return bool(token) and secrets.compare_digest(value.encode(), ('Bearer '+token).encode())


class ApiMeasurements:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http': return await self.app(scope, receive, send)
        start, status, recorded = time.perf_counter(), 500, False
        async def measured(message):
            nonlocal status, recorded
            if message['type'] == 'http.response.start': status = message['status']
            await send(message)
            if message['type'] == 'http.response.body' and not message.get('more_body', False):
                record()
        def record():
            nonlocal recorded
            route = getattr(scope.get('route'), 'path', '/unmatched')
            if not recorded and route not in ('/health','/ready','/metrics','/api/v1/browser-vitals'):
                method = scope['method'] if scope['method'] in ('GET','POST','DELETE','PUT','PATCH','OPTIONS','HEAD') else 'OTHER'
                API_LATENCY.labels(route,method,str(status)).observe(time.perf_counter()-start)
            recorded = True
        try: await self.app(scope, receive, measured)
        finally: record()


def record_usage(data):
    usage = data.get('usageMetadata', {})
    if not isinstance(usage, dict):
        COST_UNKNOWN.inc(); return
    prompt = usage.get('promptTokenCount')
    candidates = usage.get('candidatesTokenCount', 0)
    thoughts = usage.get('thoughtsTokenCount', 0)
    if not all(isinstance(value, int) and value >= 0 for value in (prompt, candidates, thoughts)):
        COST_UNKNOWN.inc(); return
    output = candidates + thoughts
    TOKENS.labels('input').inc(prompt); TOKENS.labels('output').inc(output)
    try:
        input_price = float(os.environ['GEMINI_INPUT_USD_PER_MILLION'])
        output_price = float(os.environ['GEMINI_OUTPUT_USD_PER_MILLION'])
        import math
        if not all(math.isfinite(p) and p >= 0 for p in (input_price, output_price)): raise ValueError()
    except (KeyError,ValueError): COST_UNKNOWN.inc(); return
    COST.inc((prompt*input_price+output*output_price)/1_000_000)


def start_worker_metrics():
    if not os.getenv('METRICS_TOKEN'): return
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/metrics' or not authorized(self.headers.get('Authorization','')):
                self.send_error(401); return
            payload = generate_latest()
            self.send_response(200); self.send_header('Content-Type',CONTENT_TYPE_LATEST)
            self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('0.0.0.0',9101),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server
