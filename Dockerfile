FROM python:3.12.11-slim-bookworm AS python-runtime

FROM mcr.microsoft.com/playwright:v1.60.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY --from=python-runtime /usr/local /usr/local

RUN python3 -m venv "${VIRTUAL_ENV}"

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci

COPY --chown=pwuser:pwuser . .

RUN npm run build:lan \
    && mkdir -p \
        /data \
        /app/artifacts \
        /app/playwright-report \
        /app/test-results \
        /app/tests/e2e/.draft-runs \
        /app/tests/e2e/.live-runs \
        /app/tests/e2e/.execution-configs \
    && chown -R pwuser:pwuser \
        /data \
        /app/artifacts \
        /app/playwright-report \
        /app/test-results \
        /app/tests/e2e/.draft-runs \
        /app/tests/e2e/.live-runs \
        /app/tests/e2e/.execution-configs

EXPOSE 8001

USER pwuser

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
