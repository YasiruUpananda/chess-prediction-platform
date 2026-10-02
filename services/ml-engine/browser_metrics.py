"""Anonymous, opt-in Web Vitals ingestion with bounded memory and payload size."""
import hashlib
import os
import time
from collections import OrderedDict
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from typing import Literal
from metrics import VITALS

router = APIRouter()
_seen = OrderedDict()
_clients = {}
_window = 0


class VitalSample(BaseModel):
    id: str = Field(min_length=1,max_length=100)
    name: Literal['LCP','INP','CLS']
    value: float = Field(ge=0,le=600000,allow_inf_nan=False)
    route: Literal['home','predict','reader','other']
    device: Literal['mobile','desktop']


@router.post('/api/v1/browser-vitals', status_code=204)
async def record_vital(request: Request):
    global _window
    if os.getenv('ENABLE_BROWSER_METRICS','false').lower() != 'true':
        raise HTTPException(404,detail='Browser metrics are disabled.')
    # No awaits between admission and updates; access stays on the event-loop thread.
    window = int(time.monotonic() // 60)
    if window != _window:
        _clients.clear(); _window = window
    client = hashlib.sha256((request.client.host if request.client else 'unknown').encode()).digest()
    if len(_clients) >= 1024 and client not in _clients or _clients.get(client,0) >= 120:
        raise HTTPException(429,detail='Metrics rate limit reached.')
    _clients[client] = _clients.get(client,0)+1
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content)>1024: raise HTTPException(413,detail='Metrics payload too large.')
    try: sample = VitalSample.model_validate_json(content)
    except ValidationError as error: raise HTTPException(400,detail='Invalid metrics payload.') from error
    key = (sample.id,sample.name)
    if key in _seen: return
    _seen[key] = None
    while len(_seen)>5000: _seen.popitem(last=False)
    value = sample.value if sample.name == 'CLS' else sample.value/1000
    VITALS.labels(sample.name,sample.route,sample.device).observe(value)
