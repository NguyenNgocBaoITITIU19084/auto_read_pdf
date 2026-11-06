# Auto Read PDF Pro — web version (FastAPI backend serving the built React frontend).
# The Electron desktop build is unaffected: see README for that.

# ---------- 1. Build the React frontend ----------
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Calls go to the same origin the page is served from, instead of Electron's 127.0.0.1:8000
ENV VITE_API_BASE=/api/v1
RUN npm run build

# ---------- 2. Python runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Ho_Chi_Minh \
    HOST=0.0.0.0 \
    PORT=8000 \
    DB_PATH=/data/booking_data.db \
    FRONTEND_DIST=/app/frontend/dist

WORKDIR /app

# Tesseract: the only local OCR engine on Linux (Apple Vision / Windows OCR are desktop-only).
# Reads the SP-ITC captcha and is the offline fallback for booking/container images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Build/test-only packages (pyinstaller, pytest) are left out of the image
COPY backend/requirements.txt /tmp/requirements.txt
RUN grep -vE '^(pyinstaller|pytest)==' /tmp/requirements.txt > /tmp/runtime-requirements.txt \
    && pip install -r /tmp/runtime-requirements.txt pytesseract==0.3.13 \
    && rm /tmp/*.txt

COPY backend/app backend/app
COPY --from=frontend /app/frontend/dist frontend/dist

RUN useradd --create-home --uid 1000 app \
    && mkdir -p /data \
    && chown -R app:app /data /app
USER app

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1

# One process only: APScheduler jobs run in-process and would run twice with several workers
CMD ["python", "-m", "backend.app.main"]
