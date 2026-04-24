import logging
import os
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("collectcore")

# Load backend/.env if present (simple key=value, no dependencies needed)
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from db import init_db
from file_helpers import IMAGES_DIR, INBOX_DIR, COVER_DIRS

logger.info("Loaded backend file: %s", __file__)

# ---------- Ensure directories exist ----------
INBOX_DIR.mkdir(parents=True, exist_ok=True)
(IMAGES_DIR / "library").mkdir(parents=True, exist_ok=True)
for _d in COVER_DIRS.values():
    _d.mkdir(parents=True, exist_ok=True)

# ---------- App ----------
app = FastAPI(title="CollectCore API")

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5181").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- DB init ----------
init_db()

# ---------- Static files ----------
if IMAGES_DIR.exists():
    app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")

# ---------- Routers ----------
from routers import (
    shared,
    photocards,
    books,
    graphic_novels,
    videogames,
    music,
    video,
    boardgames,
    ttrpg,
    ingest,
    export,
    admin,
    admin_lookups,
    catalog,
)

app.include_router(shared.router)
app.include_router(photocards.router)
app.include_router(books.router)
app.include_router(graphic_novels.router)
app.include_router(videogames.router)
app.include_router(music.router)
app.include_router(video.router)
app.include_router(boardgames.router)
app.include_router(ttrpg.router)
app.include_router(ingest.router)
app.include_router(export.router)
app.include_router(admin.router)
app.include_router(admin_lookups.router)
app.include_router(catalog.router)

# ---------- Frontend SPA (must be last) ----------
admin.register_frontend_static(app)
