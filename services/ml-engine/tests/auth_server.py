"""Explicit local-only browser test server with real JWT verification and stubbed Gemini."""
import asyncio
import json
from uuid import uuid4
from unittest.mock import patch
import uvicorn
import main
import predict_opponent
from database import connect
from tests.auth_fixture import signed_sessions


async def fake_report(_self, prompt):
    await asyncio.sleep(.05)
    evidence = json.loads(prompt.split('Evidence JSON:\n',1)[1])
    return {'profile':[{'text':'Test report from verified statistics','confidence':'supported',
                       'source_game_ids':[],'statistic_ids':[evidence['statistics'][0]['id']]}],
            'tendencies':[],'weaknesses':[],'recommendations':[], 'limitations':['Test provider; no paid generation.']}


if __name__ == '__main__':
    owners = [f'browser-regression-{uuid4()}' for _ in range(2)]
    with signed_sessions() as token, patch.object(predict_opponent.GeminiReportClient,'ainvoke',fake_report), \
         patch.object(predict_opponent,'cache_read',return_value=None), \
         patch.object(predict_opponent,'cache_write'), \
         patch.dict('os.environ',{'GOOGLE_API_KEY':'test-provider-no-network'}):
        @main.app.get('/_test/session',include_in_schema=False)
        def session(owner: int = 0):
            return {'token':token(owners[owner % 2]),'owner':owners[owner % 2]}
        try: uvicorn.run(main.app,host='0.0.0.0',port=8011)
        finally:
            with connect() as db:
                db.execute('DELETE FROM saved_studies WHERE owner=ANY(%s)',(owners,))
