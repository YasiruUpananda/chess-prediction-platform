"""Opt-in tracing without exporting arguments, credentials or exception text."""
import os
import inspect
import functools
from opentelemetry import trace
from opentelemetry.propagate import inject, extract
from opentelemetry import context
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter


def configure(service):
    endpoint = os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
    if not endpoint or os.getenv('OTEL_SDK_DISABLED', '').lower() == 'true': return
    if isinstance(trace.get_tracer_provider(), TracerProvider): return
    ratio = max(0, min(1, float(os.getenv('OTEL_TRACES_SAMPLE_RATIO', '0.25'))))
    provider = TracerProvider(resource=Resource.create({'service.name': service}),
                             sampler=ParentBased(TraceIdRatioBased(ratio)))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
        endpoint=endpoint.rstrip('/') + '/v1/traces', timeout=2),
        max_queue_size=512, max_export_batch_size=128))
    trace.set_tracer_provider(provider)


def traced(name):
    def decorate(function):
        def scope():
            return trace.get_tracer('neuro-chess').start_as_current_span(
                name, record_exception=False, set_status_on_exception=False)
        def failure(span, error):
            span.set_attribute('error.type', type(error).__name__)
            span.set_status(trace.Status(trace.StatusCode.ERROR))
        if inspect.iscoroutinefunction(function):
            @functools.wraps(function)
            async def asynchronous(*args, **kwargs):
                with scope() as span:
                    try: return await function(*args, **kwargs)
                    except Exception as error:
                        failure(span, error)
                        raise
            return asynchronous
        @functools.wraps(function)
        def synchronous(*args, **kwargs):
            with scope() as span:
                try: return function(*args, **kwargs)
                except Exception as error:
                    failure(span, error)
                    raise
        return synchronous
    return decorate


def carrier():
    headers = {}
    inject(headers)
    return {key: value for key, value in headers.items() if key in ('traceparent', 'tracestate')}


def continued(headers, function, *args):
    token = context.attach(extract(headers or {}))
    try:
        return function(*args)
    finally:
        context.detach(token)
