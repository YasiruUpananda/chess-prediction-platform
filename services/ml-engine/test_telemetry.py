import asyncio
import unittest
from unittest.mock import patch
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from telemetry import traced, carrier, continued


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.exporter = InMemorySpanExporter()
        self.provider = TracerProvider()
        self.provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.patches = [patch('telemetry.trace.get_tracer', self.provider.get_tracer)]
        for item in self.patches: item.start()

    def tearDown(self):
        for item in self.patches: item.stop()
        self.provider.shutdown()

    def test_thread_propagation_and_redacted_errors(self):
        @traced('authentication')
        def fail(secret):
            raise ValueError(secret)
        with self.provider.get_tracer('test').start_as_current_span('request') as parent:
            headers = carrier()
            async def run():
                with self.assertRaises(ValueError):
                    await asyncio.to_thread(continued, headers, fail, 'SECRET_TOKEN')
            asyncio.run(run())
        spans = self.exporter.get_finished_spans()
        child = next(span for span in spans if span.name == 'authentication')
        self.assertEqual(child.parent.span_id, parent.get_span_context().span_id)
        self.assertEqual(child.attributes['error.type'], 'ValueError')
        self.assertEqual(child.events, ())
        self.assertNotIn('SECRET_TOKEN', str(child.attributes))

    def test_async_span(self):
        @traced('report')
        async def result(): return 42
        self.assertEqual(asyncio.run(result()), 42)
        self.assertEqual(self.exporter.get_finished_spans()[0].name, 'report')
