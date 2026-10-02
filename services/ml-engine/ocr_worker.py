import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import ocr_jobs
from database import init_db
from backend_health import heartbeat

HEALTH_FILE = Path("/tmp/ocr-heartbeat")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("neuro_chess.ocr")


def run_extract(page, content):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "page.pdf"
        path.write_bytes(content)
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen([sys.executable, "ocr_extract.py", str(path), str(page)],
                stdout=output, stderr=subprocess.DEVNULL, start_new_session=True)
            deadline = time.monotonic() + int(os.getenv("OCR_TIMEOUT_SECONDS", "45"))
            try:
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("OCR exceeded the processing time limit")
                    heartbeat('ocr', HEALTH_FILE)
                    time.sleep(0.25)
                if process.returncode:
                    raise ValueError("Unable to read this page; check the uploaded PDF or page image")
                output.seek(0)
                return json.load(output)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


def main():
    delay = 1
    while True:
        try:
            init_db()
            while True:
                job = ocr_jobs.claim()
                heartbeat('ocr', HEALTH_FILE)
                delay = 1
                if job is None:
                    time.sleep(1)
                    continue
                job_id, page, content = job
                try:
                    result = run_extract(page, bytes(content))
                except Exception as exc:
                    logger.warning("OCR job %s failed (%s)", job_id, type(exc).__name__)
                    ocr_jobs.finish(job_id, error=str(exc) if isinstance(exc, (ValueError, TimeoutError)) else "OCR processing failed")
                else:
                    ocr_jobs.finish(job_id, result=result)
        except Exception as exc:
            HEALTH_FILE.unlink(missing_ok=True)
            logger.warning("OCR worker unavailable (%s); retrying", type(exc).__name__)
            time.sleep(delay)
            delay = min(delay * 2, 30)


if __name__ == "__main__":
    main()
