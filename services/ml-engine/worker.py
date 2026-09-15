import os
import pika
import json
import time

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")

def callback(ch, method, properties, body):
    try:
        task = json.loads(body)
        print(f" [x] Received PGN ingestion task: {task.get('filename')}")
        
        # Simulate heavy processing / vector embedding generation
        time.sleep(5)
        
        print(f" [x] Successfully processed and embedded dataset: {task.get('filename')}")
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        print(f" [!] Error processing task: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

def start_worker():
    while True:
        try:
            params = pika.URLParameters(RABBITMQ_URL)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            
            channel.queue_declare(queue='pgn_ingestion_queue', durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue='pgn_ingestion_queue', on_message_callback=callback)
            
            print(" [*] RabbitMQ Worker waiting for messages. To exit press CTRL+C")
            channel.start_consuming()
        except Exception as e:
            print(f" [!] Connection failed, retrying in 5 seconds... Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    start_worker()
    