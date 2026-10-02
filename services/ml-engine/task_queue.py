"""Confirmed, persistent ingestion messages with delayed retries and a DLQ."""
import json
import os
import pika
from telemetry import carrier

QUEUE = "pgn_ingestion_v2"
RETRY_QUEUE = QUEUE + ".retry"
DEAD_QUEUE = QUEUE + ".dead"
MAX_ATTEMPTS = 3


def connection():
    params = pika.URLParameters(os.environ["RABBITMQ_URL"])
    params.heartbeat = 30
    params.socket_timeout = 5
    params.stack_timeout = 10
    params.blocked_connection_timeout = 10
    return pika.BlockingConnection(params)


def setup(channel):
    channel.queue_declare(queue=DEAD_QUEUE, durable=True)
    channel.queue_declare(queue=QUEUE, durable=True, arguments={
        "x-max-length": 100, "x-overflow": "reject-publish",
        "x-dead-letter-exchange": "", "x-dead-letter-routing-key": DEAD_QUEUE,
    })
    # The consumer delays retries itself. This avoids classic-queue TTL
    # dead-letter forwarding losing messages when the destination is full.
    channel.queue_declare(queue=RETRY_QUEUE, durable=True)
    channel.confirm_delivery()


def publish(channel, queue, body, attempts=0, trace_headers=None):
    channel.basic_publish(exchange="", routing_key=queue, body=body, mandatory=True,
                          properties=pika.BasicProperties(delivery_mode=2,
                              content_type="application/json", headers={**(trace_headers or carrier()), "attempts": attempts}))


def enqueue(filename):
    with connection() as conn:
        channel = conn.channel()
        setup(channel)
        publish(channel, QUEUE, json.dumps({"filename": filename}).encode())


def finish(channel, delivery_tag, body, attempts, error, trace_headers=None):
    if error is not None:
        permanent = isinstance(error, (ValueError, FileNotFoundError))
        destination = DEAD_QUEUE if permanent or attempts + 1 >= MAX_ATTEMPTS else RETRY_QUEUE
        # Only acknowledge after the replacement has been confirmed.
        publish(channel, destination, body, attempts + 1, trace_headers)
    channel.basic_ack(delivery_tag=delivery_tag)
