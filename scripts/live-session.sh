#!/usr/bin/env bash
# Live session: the real app (Clerk + Maincloud + provider keys from .env.local) served from THIS laptop at
# https://live.doratcalhacks.site through the `dor-demo` Cloudflare named tunnel. Credits can only be spent while
# this runs; Ctrl-C takes the live app offline. The always-on demo (sample data, no keys) is separate:
# https://doratcalhacks.site, deployed with scripts/deploy-demo.sh.
#
#   scripts/live-session.sh            build, serve on :3000, open the tunnel
#   SKIP_BUILD=1 scripts/live-session.sh   reuse the last build
set -euo pipefail
cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null 2>&1 || { echo "Install cloudflared first: brew install cloudflared" >&2; exit 1; }
cloudflared tunnel list --name dor-demo 2>/dev/null | grep -q dor-demo || {
  echo "No 'dor-demo' tunnel for this Cloudflare login (see docs/PHONE_DEMO.md on the archive branch, or run:" >&2
  echo "  cloudflared tunnel login && cloudflared tunnel create dor-demo && cloudflared tunnel route dns dor-demo live.doratcalhacks.site)" >&2
  exit 1
}
PORT="${PORT:-3000}"

if [ "${SKIP_BUILD:-0}" != 1 ]; then npm run build:app; fi
npx next start -p "$PORT" &
APP=$!
trap 'kill "$APP" 2>/dev/null || true' EXIT INT TERM
for _ in $(seq 1 30); do curl -fs -o /dev/null "http://localhost:$PORT/manifest.webmanifest" && break; sleep 1; done

echo
echo "LIVE: https://live.doratcalhacks.site  (real accounts and provider credits; Ctrl-C to stop)"
echo "The demo at https://doratcalhacks.site shows a 'live session running' link while this is up."
echo
cloudflared tunnel --no-autoupdate run --url "http://localhost:$PORT" dor-demo
