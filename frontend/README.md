# dor · the room (front end)

Interactive mobile prototype of the dor room: the door, the room scene, moving boxes that unpack into books, the shelf, the pinboard, the window, sill, calendar, notebook, tray, drawer and door-mat settings.

## Run it

Serve this folder with any static server and open `index.html` (opening it straight from disk can block the scripts):

```sh
cd frontend
python3 -m http.server 8000
# open http://localhost:8000
```

`standalone/dor-room.html` is the same prototype as a single self-contained file (every asset inlined). It opens straight from disk.

## Layout

```
frontend/
├── index.html                 # the whole UI: markup, styles, keyframe animations and component logic
├── src/runtime/dc-runtime.js  # template runtime that renders index.html with React
├── vendor/                    # React 18.3.1 + ReactDOM UMD builds
├── assets/
│   ├── drawings/              # hand-painted scenes
│   │   ├── room.png
│   │   ├── room-through-doorway.png
│   │   ├── door-closed.png
│   │   ├── door-key-turned.png
│   │   └── door-unlocked.png
│   └── fonts/                 # Caveat, Cormorant Garamond, Reenie Beanie, Spectral (woff2)
└── standalone/dor-room.html   # single-file build
```

## How index.html works

- Markup lives inside `<x-dc>`. `{{ value }}` inserts a value, `<sc-if value="{{ x }}">` shows a block only when `x` is true, `<sc-for list="{{ items }}" as="item">` repeats a block for each item, and `sc-camel-on-click` wires up event handlers.
- The component logic is the `class Component extends DCLogic` script at the bottom: state, the room camera, box unpacking, books and history, pin cards, the quiz, nudges and so on. `renderVals()` builds every value the markup reads.
- The animations are the `@keyframes` at the top (box flaps, book open, pulsing markers, sheets) plus CSS transitions driven by state.
- The cardboard boxes, book spines, polaroids and pin cards are drawn in CSS and inline SVG. Only the room and door scenes are images.
