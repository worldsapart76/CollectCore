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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

# ---------- Host-based SPA fallback ----------
# The same FastAPI service is reached via multiple custom domains:
#   - api.collectcoreapp.com → API only (legacy + machine-to-machine)
#   - collectcoreapp.com     → SPA (the React bundle in backend/frontend_dist/)
# When a SPA path like /photocards/library is requested on the apex host,
# the browser would normally hit the photocards API router first and get
# JSON instead of the SPA. This middleware short-circuits that: on apex
# (and any non-API host), GETs that don't match a static asset prefix get
# index.html, letting React Router handle routing client-side.
_API_HOST_PREFIXES = ("api.",)
_SPA_PASSTHROUGH_PREFIXES = ("/assets/", "/images/", "/vite.svg")

@app.middleware("http")
async def spa_host_routing(request: Request, call_next):
    host = request.headers.get("host", "").split(":")[0].lower()
    is_api_host = (
        any(host.startswith(p) for p in _API_HOST_PREFIXES)
        or host in ("localhost", "127.0.0.1")
    )
    if is_api_host:
        return await call_next(request)
    if request.method != "GET":
        return await call_next(request)
    path = request.url.path
    if any(path.startswith(p) for p in _SPA_PASSTHROUGH_PREFIXES):
        return await call_next(request)
    from routers.admin import FRONTEND_DIST
    index_html = FRONTEND_DIST / "index.html"
    if index_html.exists():
        return FileResponse(str(index_html))
    return await call_next(request)

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
