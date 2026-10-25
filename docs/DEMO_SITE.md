# Demo site: tutorial, blurb and guide panels

**Status:** implemented and deployed at https://doratcalhacks.site, which is always on and uses sample data only. The source lives on `role/ai-voice`. Read this before asking Claude to change the guide, the tour or the blurb.

## Before vs after

| | Before | After |
|---|---|---|
| What's hosted | The Claude Design prototype (`frontend/`) exactly as committed, plus a small "DEMO · sample data · not live" pill at the top over the phone, and the "Made with Claude Design" badge | The same prototype, plus an injected **guide**. The demo pill sits in the bottom-left corner and opens upward; the "Made with Claude Design" badge is hidden in the hosted copy (CSS in `demo-banner.html`). |
| Layout (computer) | The phone, with the design's own reviewer column **beside it** ("dor · the room": jump to a place, simulate the other side, reset). Phone off-centre, no explanation of what dor is. | Styled like the design's own column: 300px columns 40px from the phone, vertically centred, no card backgrounds, Cormorant Garamond headings, Reenie Beanie pencil lines, small-caps labels, Spectral body, pill buttons. **Left:** a fixed blurb of what dor is (the README's opening). **Middle:** the phone, centred. **Right:** "Take the tour" or "Skip", then "jump to a place" plus "simulate the other side" (the design's buttons, proxied) plus Restart tour / Reset demo. Below that, "You're looking at", which describes whichever place is open. The design's reviewer column is hidden. |
| Tour | None | 12 steps. Each step dims the phone except one place, shows "Tap here: …", and offers "Open it for me". The dimming is clipped to the phone. |
| Narrow screens (when two 300px columns don't fit beside the phone) | The reviewer column wrapped below the phone | A **Guide** button opens a sheet with the same content. Tour steps show a card with their own Back / Next / End buttons; inside an open place the card moves to the top. |
| Design files changed | — | **None.** `frontend/` is untouched. Everything is injected at deploy time. |

## Files

| File | What it is |
|---|---|
| `scripts/demo-guide.html` | **The guide.** CSS, markup and script for the side panels, tour, jump list and mobile sheet. All the copy is here. |
| `scripts/demo-banner.html` | The "DEMO · sample data · not live" pill (bottom-left). While a live session runs, it links to `live.doratcalhacks.site`. It also hides the design tool's badge (`#__claude_design_branding`). |
| `scripts/deploy-demo.sh` | Builds and deploys: copies `frontend/` to a temp folder, inserts both HTML files before `</body>` of `index.html`, then uploads to Cloudflare Pages. |
| `frontend/` | The design itself (Claude Design). Never modified by the above. |

## How it links to the site

```
frontend/ (design)  ──┐
demo-banner.html    ──┼─ scripts/deploy-demo.sh ─► Cloudflare Pages project "dor-demo"
demo-guide.html     ──┘                              (https://dor-demo.pages.dev)
                                                              │ custom domain (DNS: CNAME @ → dor-demo.pages.dev)
                                                              ▼
                                                     https://doratcalhacks.site
```

The live app is separate: `scripts/live-session.sh` runs it on Adam's laptop and serves it at `https://live.doratcalhacks.site` through the Cloudflare tunnel `dor-demo`. It's up only while that script runs. The demo banner shows "open the live app" while it is up.

## Making changes

Edit only `scripts/demo-guide.html` (or `demo-banner.html`). Places to look:
- **Blurb (left column):** the `ABOUT` string.
- **Per-place descriptions** ("You're looking at", under the tour on the right, and the tour text on phones): the `PLACES` object. Each entry has `t` (title), `l` (one line), `d` (description) and `b` (bullets).
- **Tour order:** `ORDER`. The tour is `door → home → ORDER`.
- **Tour wording:** `guideHtml()`, which also covers the welcome screen, the step text and the button labels.
- **Simulate buttons:** `SIMS`.
- **Look:** the `<style>` block. It copies the design column's fonts and pills. Column width and gap are `COL` and `GAP` in `frame()`, which also switches to phone mode (`html.dg-narrow`) when the columns don't fit.

**Coupling to the design.** If the design changes, check these:
1. **Finding the component:** the guide follows React's internal links from page elements to the design's component, recognised by having `go()` and `skipDoor()`. It reads `state.place` and `state.doorOn`, and calls `go(place)` and `skipDoor()`.
2. **Hotspot labels:** `HOT` must match the design's hotspot `aria-label`s exactly, for example `"Pinboard · your profile"`.
3. **Reviewer column:** found by its heading text `dor · the room`. Its buttons are clicked by their exact text (`SIMS`, `Reset demo`).
4. **Door tag:** found by its text "Sign in to come in".

If one of these breaks, the demo still works; only the guide stops following along.

## Test, deploy, roll back

```sh
DRY_RUN=1 scripts/deploy-demo.sh          # prints the built folder; nothing is uploaded
cd <that folder> && python3 -m http.server 8098   # open http://localhost:8098; check ~1440x900 and phone width
scripts/deploy-demo.sh                    # deploy; doratcalhacks.site updates within a minute
```

- Deploying needs a Wrangler login to the Cloudflare account that owns the domain (`npx wrangler login`). Today that's Adam's account.
- **Roll back:** Cloudflare dashboard → Workers & Pages → dor-demo → Deployments → pick an older one → Rollback.

## Prompting Claude to revise it

Tell Claude:
- to edit `scripts/demo-guide.html`, not `frontend/`;
- to preview it with `DRY_RUN=1 scripts/deploy-demo.sh` at both computer and phone widths;
- to deploy only when asked.

Name what to change in terms of `ABOUT`, `PLACES`, `ORDER` or `guideHtml()`. If the design team renamed places or labels, ask Claude to update `HOT`, `SIMS` and the four coupling points above.
