FROM python:3.11-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    passwd \
    texlive-xetex \
    texlive-latex-extra \
    texlive-fonts-recommended \
    fonts-texgyre \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --upgrade pip && \
    pip install --require-hashes -r requirements.txt

RUN groupadd --system --gid 10001 nexora && \
    useradd --system --uid 10001 --gid nexora --create-home --home-dir /home/nexora nexora

COPY --chown=nexora:nexora . .

RUN mkdir -p /app/data /app/reports && \
    chown -R nexora:nexora /app /home/nexora

ENV PYTHONPATH=/app \
    HOME=/home/nexora \
    USER=nexora \
    LOGNAME=nexora

USER nexora:nexora

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.getenv('PORT', '8000'), timeout=5)"]

FROM base AS studio

USER root
COPY requirements-studio.txt ./requirements-studio.txt
RUN pip install --require-hashes -r requirements-studio.txt
USER nexora:nexora

FROM base AS runtime

CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
