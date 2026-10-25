#!/usr/bin/env node
/**
 * Live UI build: copies the Claude Design room (frontend/, never modified) to public/live/ as the phone-only screen the
 * live app shows in a full-screen iframe (src/components/live). Each edit below is an exact string replacement that
 * must match once; if the design is re-exported and a target moved, the build fails here instead of shipping a page
 * the bridge can't drive.
 *
 *   node scripts/build-live-ui.mjs
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'frontend');
const out = join(root, 'public', 'live');

let html = readFileSync(join(src, 'index.html'), 'utf8');

function edit(label, from, to) {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`build-live-ui: "${label}" matched ${n} times (expected 1); the design changed, update this script`);
  html = html.replace(from, to);
}

// 1. Phone screen only: no bezel, no reviewer column, no fake status bar, no design-tool badge.
edit('page wrapper',
  'min-height:100vh;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:40px;padding:24px;box-sizing:border-box;background:#EFE8CF;',
  'height:100dvh;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:0;box-sizing:border-box;background:transparent;');
edit('bezel',
  'width:410px;height:864px;transform:scale({{ zoom }});transform-origin:0 0;border-radius:62px;background:#1B1A17;padding:10px;box-sizing:border-box;box-shadow:0 30px 80px rgba(27,26,23,.28)',
  'width:390px;height:844px;transform:scale({{ zoom }});transform-origin:0 0;padding:0;box-sizing:border-box');
edit('screen corners',
  'style="position:relative;width:390px;height:844px;border-radius:52px;overflow:clip;',
  'style="position:relative;width:390px;height:844px;overflow:clip;');
edit('status bar',
  'height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 30px 0 36px;',
  'height:50px;display:none;align-items:center;justify-content:space-between;padding:0 30px 0 36px;');
edit('reviewer column',
  '<div style="width:300px;max-width:100%;display:flex;flex-direction:column;gap:18px">',
  '<div style="display:none">');
edit('frame size', 'frameW:Math.round(410*s.zoom), frameH:Math.round(864*s.zoom)', 'frameW:Math.round(390*s.zoom), frameH:Math.round(844*s.zoom)');
// Fit the whole 390×844 screen (nothing cropped: the door mat and bottom sheets sit at the very bottom).
edit('fit', 'Math.min(1, (window.innerHeight-48)/864, (window.innerWidth-32)/410)', 'Math.min(window.innerHeight/844, window.innerWidth/390)');
// Any side margin left on a short viewport (browser toolbars) is painted the drawing's wall colour, so it reads as wall.
html = html.replace('</head>', '<style>#__claude_design_branding{display:none!important}html,body{margin:0;overscroll-behavior:none;background:#F2F0EA!important}@keyframes dorSpin{to{transform:rotate(360deg)}}</style>\n</head>');

// 2. Bridge hook: the parent page (same origin) adopts the component instance before anything else runs.
edit('bridge hook', '  componentDidMount(){\n',
  '  componentDidMount(){\n    try { window.parent && window.parent !== window && window.parent.__dorLive && window.parent.__dorLive.attach(this); } catch (e) { console.error(e); }\n');

// 3. Sample copy that lives in markup becomes template values the bridge fills from live data.
edit('tray note', '>Maybe check in with Sam this week.<', '>{{ live.planeText }}<');
edit('tray hand note', 'a fixed note from your pairing with sam. nothing either of you wrote is in it.',
  'a fixed note from your pairing with {{ live.planeWho }}. nothing either of you wrote is in it.');
edit('tray pause', 'Pause notes about Sam<', 'Turn off notes from {{ live.planeName }}<');
edit('nudge note', '>Maybe check in with Maya this week.<div', '>{{ live.nudgeText }}<div');
edit('nudge note sub', 'a note from dor · nothing Maya wrote is included', 'a note from dor · nothing you wrote is included');
edit('nudge to', `<span style="font:600 44px/1 'Caveat'">Leo</span>`, `<span style="font:600 44px/1 'Caveat'">{{ live.nudgeName }}</span>`);
edit('nudge help', 'This is exactly what Leo will see. Hold the stamp for a moment to send it.', '{{ live.nudgeHelp }}');
edit('mat name', `<div style="position:relative;font:600 46px/1 'Caveat'">Noor</div>`, `<div style="position:relative;font:600 46px/1 'Caveat'">{{ live.envName }}</div>`);
edit('mat chapter', `<div style="position:relative;margin-top:2px;font:italic 400 15px 'Spectral',serif">New job · Berkeley</div>`,
  `<div style="position:relative;margin-top:2px;font:italic 400 15px 'Spectral',serif">{{ live.envLine }}</div>`);
edit('mat ask', '>would like to grab coffee</div>', '>{{ live.envAsk }}</div>');
edit('mat from', `<div style="position:absolute;left:24px;top:150px;font:600 28px/1 'Caveat'">Maya</div>`,
  `<div style="position:absolute;left:24px;top:150px;font:600 28px/1 'Caveat'">{{ live.myName }}</div>`);
edit('mat body', 'Noor is new in Berkeley too. You were both open to coffee.', '{{ live.envBody }}');
edit('postcard name', `<span style="position:relative;font:600 38px/1 'Caveat'">Maya</span>`, `<span style="position:relative;font:600 38px/1 'Caveat'">{{ live.myName }}</span>`);
edit('interest share', '>Maya is interested in<br>', '>{{ live.myName }} is interested in<br>');
edit('feed age', '">checked 2 h ago</span>', '">{{ live.feedAge }}</span>');
edit('open listing', `<button style="border:none;background:none;padding:12px 2px;font:400 15px 'Spectral',serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer;white-space:nowrap">Open listing ↗</button>`,
  `<button sc-camel-on-click="{{ live.openListing }}" style="border:none;background:none;padding:12px 2px;font:400 15px 'Spectral',serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer;white-space:nowrap">Open listing ↗</button>`);
edit('door nameplate', 'animation:popIn .5s cubic-bezier(0.19,1.51,0.29,0.99) both">maya</div>',
  'animation:popIn .5s cubic-bezier(0.19,1.51,0.29,0.99) both">{{ live.plate }}</div>');
edit('room caption', 'moving in · watercolour, maya’s room', 'moving in · watercolour, your room');
edit('mat silent', 'not now and block are silent. noor won’t be told.', 'not now is silent. {{ live.envName }} won’t be told.');

// 4. D050 urgent support: the design has no screen for it, so the notebook gets a resource card in the design's own type.
const SHEET = 'position:absolute;left:0;right:0;bottom:0;background:#FAF7F0;border-radius:24px 24px 0 0;box-shadow:0 -12px 40px rgba(27,26,23,.10);padding:22px 22px 30px;z-index:12;animation:sheetIn .5s cubic-bezier(0.55,0,0.1,1) both';
const LINK = "display:block;margin-top:10px;height:50px;line-height:50px;border-radius:12px;background:#1B1A17;color:#FAF7F0;text-align:center;text-decoration:none;font:500 16px 'Spectral',serif";
edit('support card', '<sc-if value="{{ nudgeOn }}" hint-placeholder-val="{{ false }}">',
  `<sc-if value="{{ live.support }}" hint-placeholder-val="{{ false }}"><div style="position:absolute;inset:0;background:rgba(250,247,240,.82);z-index:11"></div><div role="dialog" aria-label="Support" style="${SHEET}">` +
  `<div style="font:500 26px/1.2 'Cormorant Garamond',serif">You deserve support right now.</div>` +
  `<div style="margin-top:8px;font:400 16px/24px 'Spectral',serif">If you’re in the United States, you can call or text 988, the Suicide &amp; Crisis Lifeline, any time. If you’re in immediate danger, call 911.</div>` +
  `<a href="tel:988" style="${LINK}">Call 988</a><a href="sms:988" style="${LINK};background:transparent;color:#1B1A17;border:1px solid #1B1A17">Text 988</a>` +
  `<a href="https://988lifeline.org/chat/" target="_blank" rel="noopener" style="display:block;margin-top:12px;text-align:center;font:400 15px 'Spectral',serif;color:#1B1A17">Chat at 988lifeline.org</a>` +
  `<div style="margin-top:12px;font:400 19px/1.2 'Reenie Beanie';color:#6B665D">nothing was shared, and no one was contacted.</div>` +
  `<button sc-camel-on-click="{{ live.supportClose }}" style="margin-top:6px;border:none;background:none;padding:12px 0;font:400 15px 'Spectral',serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer">Close</button></div></sc-if>\n` +
  '<sc-if value="{{ nudgeOn }}" hint-placeholder-val="{{ false }}">');

// 5. Notebook as a conversation: the right page scrolls (newest words in view) instead of running off the book; dor's
//    spoken questions appear in blue pencil between the writer's words; Start over clears everything; after the writer
//    stops talking they choose Keep talking (one question, read aloud) or Send (private reflection + reasoning).
edit('notebook scroll open', '<sc-if value="{{ nb.showWords }}" hint-placeholder-val="{{ false }}"><button sc-camel-on-click="{{ nbEdit }}" style="display:block;width:100%;margin-top:22px;',
  '<sc-if value="{{ nb.showWords }}" hint-placeholder-val="{{ false }}"><div data-nbscroll="1" style="margin-top:22px;max-height:318px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none"><button sc-camel-on-click="{{ nbEdit }}" style="display:block;width:100%;margin-top:0;');
edit('notebook scroll close', '</sc-for></button></sc-if>', '</sc-for></button></div></sc-if>');
edit('notebook word style', '<span style="display:inline-block;margin-right:6px;animation:wordIn .3s cubic-bezier(0.23,1,0.32,1) {{ w.d }}ms both">{{ w.t }}</span>',
  '<span style="display:inline-block;margin-right:6px;color:{{ w.c }};font:{{ w.f }};animation:wordIn .3s cubic-bezier(0.23,1,0.32,1) {{ w.d }}ms both">{{ w.t }}</span>');
edit('notebook start over', '>🔒︎ Lock</button>',
  '>🔒︎ Lock</button><sc-if value="{{ live.nbCanReset }}" hint-placeholder-val="{{ false }}"><button sc-camel-on-click="{{ live.nbReset }}" aria-label="Start over" ' +
  `style="position:absolute;left:10px;bottom:54px;height:36px;padding:0 12px;border:1px solid #E4DFD2;border-radius:18px;background:#FBF4E4;font:400 13px 'Spectral',serif;color:#1B1A17;cursor:pointer">↺ Start over</button></sc-if>`);
edit('notebook actions', `<div style="font:400 15px 'Spectral',serif;white-space:nowrap">{{ nb.micLabel }}</div>`,
  '<sc-if value="{{ live.nbActions }}" hint-placeholder-val="{{ false }}"><div style="display:flex;gap:8px;margin-bottom:4px">' +
  `<button sc-camel-on-click="{{ live.nbMore }}" style="height:42px;padding:0 16px;border:1px solid #1B1A17;border-radius:21px;background:#FAF7F0;color:#1B1A17;font:400 15px 'Spectral',serif;cursor:pointer">Keep talking</button>` +
  `<button sc-camel-on-click="{{ live.nbSend }}" style="height:42px;padding:0 20px;border:none;border-radius:21px;background:#1B1A17;color:#FAF7F0;font:500 15px 'Spectral',serif;cursor:pointer">Send</button></div></sc-if>` +
  `<div style="font:400 15px 'Spectral',serif;white-space:nowrap">{{ nb.micLabel }}</div>`);

// 6. D060: the window's own refresh button (live Apify scrape) in the feed sheet, and a visible "sending to dor's agent"
//    banner on the notebook page while the private reflection and the reasoning run.
const WINDOW_NOTE = `<div style="margin-top:4px;font:400 20px/1.15 'Reenie Beanie';color:#6B665D">listings never show who else is going</div>`;
edit('window refresh', WINDOW_NOTE, WINDOW_NOTE +
  `<button sc-camel-on-click="{{ live.refreshTap }}" aria-label="Refresh nearby events and places" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;width:100%;height:44px;border-radius:22px;border:1px solid #1B1A17;background:#FAF7F0;color:#1B1A17;font:500 15px 'Spectral',serif;cursor:pointer">` +
  `<sc-if value="{{ live.refreshBusy }}" hint-placeholder-val="{{ false }}"><span style="width:12px;height:12px;border-radius:50%;border:2px solid #C9C2B2;border-top-color:#1B1A17;animation:dorSpin .8s linear infinite;flex:none"></span></sc-if>` +
  `<span>{{ live.refreshLabel }}</span></button>`);
const NB_STATE = `<div style="margin-top:6px;font-size:13px;font-variant:small-caps;letter-spacing:.06em;color:#6B665D">{{ nb.stateLabel }}</div>`;
edit('notebook busy', NB_STATE, NB_STATE +
  `<sc-if value="{{ live.nbBusyOn }}" hint-placeholder-val="{{ false }}"><div role="status" aria-live="polite" style="position:relative;z-index:3;margin-top:8px;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:14px;background:#EAF1FA;color:#2F5C91;font:400 13px/1.25 'Spectral',serif">` +
  `<span style="width:12px;height:12px;border-radius:50%;border:2px solid #A9C3E3;border-top-color:#2F5C91;animation:dorSpin .8s linear infinite;flex:none"></span><span>{{ live.nbBusyText }}</span></div></sc-if>`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['assets', 'vendor', 'src']) cpSync(join(src, dir), join(out, dir), { recursive: true });
writeFileSync(join(out, 'index.html'), html);
console.log(`build-live-ui: wrote ${join('public', 'live', 'index.html')} (${html.length} bytes)`);
