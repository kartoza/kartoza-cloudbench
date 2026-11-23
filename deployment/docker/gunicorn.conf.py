import multiprocessing
import os

bind = "0.0.0.0:8000"
workers = int(os.environ.get("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))
# Threads, not one request per worker: an upload relayed to GeoServer/GeoNode
# (apps/upload/relay.py) holds a request while the target catches up, and the
# relay itself runs in its worker's threads.
worker_class = "gthread"
threads = int(os.environ.get("GUNICORN_THREADS", 8))
timeout = 120
keepalive = 5
# Rare: recycling a worker kills the uploads it relays and the conversions it
# runs, and a big upload alone is thousands of requests. Still a guard against
# a slow memory leak.
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", 100000))
max_requests_jitter = 100
preload_app = True
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")
