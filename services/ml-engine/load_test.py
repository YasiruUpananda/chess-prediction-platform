"""Local mixed-workload load test. Targets ONLY the explicit stub-provider test server."""
import argparse
import asyncio
import io
import json
import math
import time
from collections import defaultdict, Counter
import httpx
import chess
from PIL import Image, ImageDraw


async def run(base, concurrency=8):
    if base not in ('http://browser-api:8011','http://127.0.0.1:8011','http://localhost:8011'):
        raise ValueError('Use only the local browser test server; this script never loads a production API.')
    results=defaultdict(list)
    slots=asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(base_url=base,timeout=90) as client:
        sessions=[(await client.get(f'/_test/session?owner={i}')).json() for i in range(2)]
        headers=[{'Authorization':'Bearer '+session['token']} for session in sessions]
        players=(await client.get('/api/v1/players',headers=headers[0])).json()['players']
        player=max(players,key=lambda item:item['games'])['name']
        jobs=[]
        async def request(kind,path,owner=0,**kwargs):
            async with slots:
                started=time.perf_counter()
                response=await client.request('POST' if 'json' in kwargs or 'files' in kwargs else 'GET',path,headers=headers[owner],**kwargs)
                results[kind].append(((time.perf_counter()-started)*1000,response.status_code))
                return response
        # Warm embedding retrieval; token generation is stubbed by tests.auth_server.
        await request('report-warmup','/api/v1/predict-strategy',json={'opponent_name':player,'context':'warmup'})
        moves=['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6']
        bodies=[]
        board=chess.Board()
        for i,move in enumerate(moves):
            board.push_uci(move)
            bodies.append({'fen':board.fen(),'initial_fen':chess.STARTING_FEN,'moves':moves[:i+1],'opponent_username':player})
        image=Image.new('RGB',(600,150),'white'); ImageDraw.Draw(image).text((20,40),'1. e4 e5 2. Nf3 Nc6',fill='black',font_size=32)
        encoded=io.BytesIO(); image.save(encoded,format='PNG')
        async def submit_ocr(i):
            response=await request('ocr-submit','/api/v1/extract-page-image',i%2,
                files={'file':('page.png',encoded.getvalue(),'image/png')},data={'page':str(i+1)})
            if response.status_code==202: jobs.append((response.json()['job_id'],i%2))
        workload=[request('players','/api/v1/players',i%2) for i in range(20)]
        workload += [request('move','/api/v1/predict-move',i%2,json=bodies[i%len(bodies)]) for i in range(36)]
        workload += [request('report','/api/v1/predict-strategy',i%2,json={'opponent_name':player,'context':f'load case {i}'}) for i in range(6)]
        workload += [submit_ocr(i) for i in range(4)]
        await asyncio.gather(*workload)
        deadline=time.monotonic()+90
        while jobs and time.monotonic()<deadline:
            pending=[]
            for job_id,owner in jobs:
                response=await client.get('/api/v1/ocr-jobs/'+job_id,headers=headers[owner])
                job=response.json()
                if job.get('status') in ('queued','running'): pending.append((job_id,owner))
                elif job.get('status')!='completed': raise AssertionError('OCR failed during load test')
            jobs=pending
            if jobs: await asyncio.sleep(.25)
        if jobs: raise AssertionError('OCR did not finish before the test deadline')
        summary={}
        for kind,samples in results.items():
            durations=sorted(duration for duration,_status in samples)
            summary[kind]={'requests':len(samples),'p95_ms':round(durations[math.ceil(.95*len(durations))-1],2),
                           'statuses':dict(Counter(str(status) for _,status in samples))}
        unexpected=[status for values in results.values() for _duration,status in values if status not in (200,202,429)]
        if unexpected: raise AssertionError(f'Unexpected statuses: {unexpected}; summary={summary}')
        return {'concurrency':concurrency,'provider':'stubbed; no paid calls','summary':summary}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',default='http://browser-api:8011')
    parser.add_argument('--concurrency',type=int,default=8,choices=range(1,33))
    args=parser.parse_args()
    print(json.dumps(asyncio.run(run(args.base_url,args.concurrency)),indent=2))
