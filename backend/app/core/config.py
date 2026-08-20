import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR
DB_PATH = os.environ.get("DB_PATH", str(DATA_DIR / "booking_data.db"))
BACKEND_PORT = int(os.environ.get("PORT", "8000"))
BACKEND_HOST = os.environ.get("HOST", "127.0.0.1")
