// dor live gate: sits in front of https://live.doratcalhacks.site.
// - Live session running (laptop + tunnel up): pass every request through unchanged; HTML pages get a small
//   "LIVE · real accounts" pill linking to the demo.
// - Not running (Cloudflare answers 530/52x for the tunnel): page loads get a friendly offline page that links to
//   the demo and re-checks every 30 s; anything else gets a plain 503, so the demo's banner probe reads "not live".
// - GET /__status -> {"live": true|false} with CORS for the demo site.
// No cookies, credentials or request bodies are read or stored here.

const DEMO = 'https://doratcalhacks.site';
const DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530]);

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="30"><title>dor · not live right now</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #faf7f0; color: #1b1a17;
    font: 17px/1.5 Georgia, "Times New Roman", serif; padding: 24px; box-sizing: border-box; }
  main { max-width: 26rem; text-align: center; }
  h1 { font-weight: 500; font-size: 30px; margin: 0 0 8px; }
  p { margin: 0 0 14px; color: #4a463f; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #8a5a00; margin-right: 6px; }
  a.button { display: inline-block; margin-top: 10px; padding: 14px 22px; border-radius: 999px; background: #1b1a17;
    color: #faf7f0; text-decoration: none; font-weight: 500; }
  small { display: block; margin-top: 18px; color: #6b665d; font-size: 14px; }
</style></head><body><main>
  <p><span class="dot"></span>Not live right now</p>
  <h1>The live app isn’t running</h1>
  <p>dor’s live app runs only during scheduled sessions while the backend is in development.
     You can explore the full design with sample data in the meantime.</p>
  <a class="button" href="${DEMO}">Open the demo</a>
  <small>This page checks again every 30 seconds and opens the live app when a session starts.</small>
</main></body></html>`;

const LIVE_PILL = `<div id="dor-live-pill" style="position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);
top:max(8px,env(safe-area-inset-top));font:500 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
background:rgba(234,242,252,.96);color:#2f5c91;border:1px solid #c9dcf3;border-radius:999px;padding:7px 12px;
box-shadow:0 2px 10px rgba(27,26,23,.12);white-space:nowrap">
<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#2e7d4f;margin-right:6px"></span>
LIVE · real accounts · <a href="${DEMO}" style="color:#2f5c91;font-weight:600">demo</a>
<button type="button" aria-label="Hide" onclick="this.parentElement.remove()" style="all:unset;cursor:pointer;margin-left:6px">✕</button></div>`;

async function originUp(origin) {
  try {
    const r = await fetch(`${origin}/manifest.webmanifest`, { headers: { 'cache-control': 'no-cache' }, cf: { cacheTtl: 0 } });
    return r.ok;
  } catch {
    return false;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/__status') {
      const live = await originUp(url.origin);
      return new Response(JSON.stringify({ live }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': DEMO },
      });
    }

    let res;
    try {
      res = await fetch(request);
    } catch {
      res = null;
    }

    if (!res || DOWN.has(res.status)) {
      const wantsPage = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
      return wantsPage
        ? new Response(OFFLINE_PAGE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' } })
        : new Response('dor live app is not running', { status: 503, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }

    if ((res.headers.get('content-type') || '').startsWith('text/html')) {
      return new HTMLRewriter().on('body', { element(el) { el.append(LIVE_PILL, { html: true }); } }).transform(res);
    }
    return res;
  },
};
