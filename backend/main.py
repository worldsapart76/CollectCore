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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- SPA fallback (host- + path-based routing) ----------
# The same FastAPI service is reached via two custom domains today:
#   - api.collectcoreapp.com → API only (machine-to-machine + cross-subdomain
#     fetches from the SPA, which can include CF Access cookies because both
#     hosts are under the same Cloudflare Access app).
#   - collectcoreapp.com     → SPA host. Two SPAs are mounted under it:
#       /         → admin SPA  (backend/frontend_dist/)
#       /guest/*  → guest SPA  (backend/frontend_dist_guest/)
#
# Why path-routing for guest instead of a `guest.` subdomain? Railway's
# free tier limits custom domains to two (api + apex), and Cloudflare Access
# only needs one bypass policy added to the existing apex app to expose
# /guest/* publicly. Trade-off: URL is collectcoreapp.com/guest/ instead
# of guest.collectcoreapp.com.
#
# Path collision protection: a SPA route like /photocards/library would
# normally hit the photocards API router first and get JSON. This middleware
# short-circuits — on the apex host, GETs that don't match a static asset
# prefix or the API host return the right index.html (admin or guest), so
# React Router handles routing client-side.
#
# Static assets are URL-disambiguated so neither SPA fights for /assets/:
#   admin → /assets/         (Vite default)
#   guest → /guest/guest-assets/  (Vite base='/guest/' + assetsDir='guest-assets')
_API_HOST_PREFIXES = ("api.",)
_GUEST_PATH_PREFIX = "/guest"
_SPA_PASSTHROUGH_PREFIXES = (
    "/assets/",
    "/guest/guest-assets/",
    "/images/",
    "/vite.svg",
    "/guest/vite.svg",
)

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
    from routers.admin import FRONTEND_DIST, FRONTEND_DIST_GUEST
    # Anything under /guest (with or without trailing path) gets the guest
    # bundle's index.html so React Router with basename='/guest' can take over.
    is_guest_path = path == _GUEST_PATH_PREFIX or path.startswith(_GUEST_PATH_PREFIX + "/")
    dist = FRONTEND_DIST_GUEST if is_guest_path else FRONTEND_DIST
    index_html = dist / "index.html"
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
