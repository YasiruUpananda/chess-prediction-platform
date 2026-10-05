FROM python:3.11-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /uvx /bin/
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./

FROM base AS source
WORKDIR /source
COPY *.py ./
COPY migrations ./migrations
COPY tools ./tools

FROM base AS embeddings
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra embeddings

FROM embeddings AS api-dependencies
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra embeddings --extra api
COPY install_stockfish.py /tmp/install_stockfish.py
RUN python /tmp/install_stockfish.py

FROM api-dependencies AS api
COPY --from=source /source /app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM embeddings AS ingestion
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra embeddings --extra ingestion
COPY --from=source /source /app
CMD ["python", "worker.py"]

FROM base AS migration
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY --from=source /source /app
CMD ["python", "migrate.py", "apply"]

FROM base AS ocr
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra ocr
COPY --from=source /source /app
CMD ["python", "ocr_worker.py"]

FROM api-dependencies AS test
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra embeddings --extra api --group test
COPY . .

FROM api AS default
