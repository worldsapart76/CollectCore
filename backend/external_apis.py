"""
Shared HTTP clients for external APIs (Google Books, etc.).

Each caller is responsible for normalizing the returned JSON into module-specific
shapes — this module only handles URL assembly, auth, and raw JSON retrieval.
"""

import json
import os
import urllib.parse
import urllib.request

GOOGLE_BOOKS_API_KEY = os.environ.get("GOOGLE_BOOKS_API_KEY", "")
GOOGLE_BOOKS_BASE = "https://www.googleapis.com/books/v1/volumes"
_DEFAULT_HEADERS = {"User-Agent": "CollectCore/1.0"}


def google_books_search(query: str, max_results: int = 10, timeout: int = 6) -> list[dict]:
    """Search Google Books by free-text query. Returns the `items` list (may be empty)."""
    url = f"{GOOGLE_BOOKS_BASE}?q={urllib.parse.quote(query)}&maxResults={max_results}"
    if GOOGLE_BOOKS_API_KEY:
        url += f"&key={GOOGLE_BOOKS_API_KEY}"
    req = urllib.request.Request(url, headers=_DEFAULT_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data.get("items", [])


def google_books_lookup_isbn(isbn: str, max_results: int = 1, timeout: int = 6) -> list[dict]:
    """Look up Google Books entries for a given ISBN. Returns the `items` list (may be empty)."""
    return google_books_search(f"isbn:{isbn}", max_results=max_results, timeout=timeout)


def google_books_get_volume(volume_id: str, timeout: int = 6) -> dict:
    """Fetch a specific Google Books volume by its ID."""
    url = f"{GOOGLE_BOOKS_BASE}/{urllib.parse.quote(volume_id)}"
    if GOOGLE_BOOKS_API_KEY:
        url += f"?key={GOOGLE_BOOKS_API_KEY}"
    req = urllib.request.Request(url, headers=_DEFAULT_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())
