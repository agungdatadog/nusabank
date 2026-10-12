# Build context is the repo root (tools/build/cloudbuild.yaml).
FROM python:3.13.9-slim-bookworm AS test
WORKDIR /app
COPY services/ai-agent/requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt && pip install --no-cache-dir pytest==8.4.2
COPY services/ai-agent/app ./app
COPY services/ai-agent/tests ./tests
RUN python -m pytest -q tests

FROM python:3.13.9-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY services/ai-agent/requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt && useradd --uid 10001 --no-create-home agent
COPY services/ai-agent/app ./app
USER 10001
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
