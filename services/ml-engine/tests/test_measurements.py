import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import main
from metrics import VITALS, COST, COST_UNKNOWN, record_usage


class MeasurementTests(unittest.TestCase):
    def test_private_scrape_and_bounded_vitals(self):
        client=TestClient(main.app)
        with patch.dict(os.environ,{'METRICS_TOKEN':'test-secret','ENABLE_BROWSER_METRICS':'true'}):
            self.assertEqual(client.get('/metrics').status_code,401)
            response=client.get('/metrics',headers={'Authorization':'Bearer test-secret'})
            self.assertEqual(response.status_code,200)
            self.assertNotIn('test-secret',response.text)
            sample={'name':'LCP','value':2500,'id':'measurement-test','route':'home','device':'mobile'}
            histogram=VITALS.labels('LCP','home','mobile')
            before=histogram._sum.get()
            self.assertEqual(client.post('/api/v1/browser-vitals',json=sample).status_code,204)
            self.assertEqual(client.post('/api/v1/browser-vitals',json=sample).status_code,204)
            self.assertAlmostEqual(histogram._sum.get()-before,2.5)
            self.assertEqual(client.post('/api/v1/browser-vitals',json={**sample,'route':'/private?token=secret'}).status_code,400)
            self.assertEqual(client.post('/api/v1/browser-vitals',content='a'*1025).status_code,413)

    def test_cost_requires_usage_and_prices(self):
        unknown=COST_UNKNOWN._value.get()
        with patch.dict(os.environ,{'GEMINI_INPUT_USD_PER_MILLION':'','GEMINI_OUTPUT_USD_PER_MILLION':''}):
            record_usage({'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':50}})
        self.assertEqual(COST_UNKNOWN._value.get(),unknown+1)
        before=COST._value.get()
        with patch.dict(os.environ,{'GEMINI_INPUT_USD_PER_MILLION':'1','GEMINI_OUTPUT_USD_PER_MILLION':'2'}):
            record_usage({'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':40,'thoughtsTokenCount':10}})
        self.assertAlmostEqual(COST._value.get()-before,.0002)
