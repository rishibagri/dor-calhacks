#!/usr/bin/env bash
# Always-on demo (no backend, no keys): deploy frontend/ to Cloudflare Pages as https://doratcalhacks.site.
# The hosted copy gets scripts/demo-banner.html and scripts/demo-guide.html (about panel, feature notes, tour) injected ("DEMO · sample data · not live", plus a link to
# https://live.doratcalhacks.site when the laptop tunnel is up). frontend/ itself is never modified.
#
#   scripts/deploy-demo.sh            deploy frontend/ from the current checkout (usually main)
#   DRY_RUN=1 scripts/deploy-demo.sh  build the copy and print its path, don't upload
#
# Needs a one-time `npx wrangler login` for the Cloudflare account that owns doratcalhacks.site.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${DOR_PAGES_PROJECT:-dor-demo}"
[ -f frontend/index.html ] || { echo "frontend/index.html not found (pull main?)" >&2; exit 1; }
grep -q '</body>' frontend/index.html || { echo "frontend/index.html has no </body> to inject the banner into" >&2; exit 1; }

OUT="$(mktemp -d)/site"
cp -R frontend "$OUT"
rm -f "$OUT/README.md"
# Insert the banner just before </body> (the last one) in index.html.
python3 - "$OUT/index.html" scripts/demo-banner.html scripts/demo-guide.html <<'EOF'
import sys
page = open(sys.argv[1]).read()
extra = ''.join(open(f).read() for f in sys.argv[2:])
i = page.rfind('</body>')
open(sys.argv[1], 'w').write(page[:i] + extra + page[i:])
EOF
grep -q 'id="dor-demo-banner"' "$OUT/index.html" && grep -q 'dg-panel' "$OUT/index.html" || { echo "banner/guide injection failed" >&2; exit 1; }
echo "Built demo copy with banner: $OUT ($(git rev-parse --short HEAD))"

if [ "${DRY_RUN:-0}" = 1 ]; then exit 0; fi
npx -y wrangler@4 pages deploy "$OUT" --project-name "$PROJECT" --branch main --commit-dirty=true \
  --commit-message "frontend $(git rev-parse --short HEAD)"
