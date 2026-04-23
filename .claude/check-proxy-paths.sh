#!/usr/bin/env bash
# Check that all backend route prefixes are listed in PROXY_PATHS in vite.config.js.
# Called as a PostToolUse hook after edits to backend router files.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VITE_CONFIG="$PROJECT_ROOT/frontend/vite.config.js"
BACKEND_DIR="$PROJECT_ROOT/backend"

# Read hook input from stdin and extract file_path
INPUT=$(cat)
# Try tool_input.file_path first, then tool_response.filePath
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$FILE_PATH" ]; then
  FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"filePath"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

# Normalize to forward slashes
FILE_PATH=$(echo "$FILE_PATH" | tr '\\' '/')

# Only check if the edited file is a backend router or main.py
case "$FILE_PATH" in
  */backend/routers/*.py|*/backend/main.py) ;;
  *) exit 0 ;;
esac

# Extract PROXY_PATHS entries from vite.config.js (lines like '/books',)
PROXY_PATHS=$(sed -n "s/.*'\(\/[a-z-]*\)'.*/\1/p" "$VITE_CONFIG" | sort -u)

# Extract router prefixes: APIRouter(prefix="/something")
ROUTER_PREFIXES=$(sed -n 's/.*APIRouter(prefix="\(\/[a-z-]*\)".*/\1/p' "$BACKEND_DIR"/routers/*.py 2>/dev/null | sort -u)

# Extract top-level paths from shared.py: @router.get("/something...")
SHARED_PATHS=$(sed -n 's/.*@router\.[a-z]*("\(\/[a-z-]*\).*/\1/p' "$BACKEND_DIR/routers/shared.py" 2>/dev/null | sort -u)

# Extract app.mount paths: app.mount("/something", ...)
MOUNT_PATHS=$(sed -n 's/.*app\.mount("\(\/[a-z-]*\)".*/\1/p' "$BACKEND_DIR/main.py" 2>/dev/null | sort -u)

# Combine all backend paths
ALL_BACKEND_PATHS=$(echo -e "$ROUTER_PREFIXES\n$SHARED_PATHS\n$MOUNT_PATHS" | sort -u | grep -v '^$' || true)

# Find missing paths
MISSING=""
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! echo "$PROXY_PATHS" | grep -qx "$path"; then
    MISSING="$MISSING $path"
  fi
done <<< "$ALL_BACKEND_PATHS"

if [ -n "$MISSING" ]; then
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"PROXY PATH CHECK FAILED: The following backend route prefixes are NOT in PROXY_PATHS in frontend/vite.config.js:${MISSING} — Add them now or API calls will return HTML instead of JSON (the Unexpected token < error).\"}}"
fi
