# Hermes 3D

Route: `/hermes3d` · UI: `src/components/v2/hermes3d/Hermes3DView.tsx`, `HermesOffice.tsx`, `Hermes3DSettings.tsx` · Backend: `src/lib/v2/hermes3d/` (no API routes; assets are static files under `public/hermes3d/`)

A 3D office scene rendered in the browser with three.js, built from baked Synty assets. You can orbit and zoom around the office, and a few chairs can hold idle seated characters. It does not show agent activity yet: nothing in the scene reads run state, and the on-screen summary says so.

## Tabs and controls

The page is one scene with a gear. There are no tabs.

### Scene

| Control | What it does |
|---|---|
| **Drag** | Orbits the camera around the office. |
| **Mouse wheel** | Zooms in and out. |
| Summary box (bottom left) | Once loaded, shows the office mesh and triangle counts, seat anchors, clips in the library, fps when enabled, how many bodies are seated, and any file that failed to load. |

Other states the scene area can show:

- **Checking for baked assets...** / **Loading <file>...** while it loads.
- **Assets not baked** when `public/hermes3d/office.glb` is missing, with the failed request.
- **Scene failed** when the office file fails to load or holds zero meshes.

### Gear (Configure, titled "Hermes 3D")

Every change saves straight away and rebuilds the scene.

| Control | What it does |
|---|---|
| **Quality** (`full` / `lite`) | Lite drops the fill light and antialiasing and caps pixel ratio at 1, for slower laptops. |
| **Shadows** | Turns shadow casting on or off. Off by default. |
| **Show fps in the HUD** | Adds the frame rate to the summary box. Off by default. |
| **Seated bodies** | 0 to 18 idle characters on the chairs nearest the floor centre. 0 shows the empty office. Default 4. |

## How it works

- Everything loads from static files: `public/hermes3d/office.glb`, `office-seats.json` (chair positions), `hermes-clips.glb` (animation clips) and `characters/<name>.glb` plus a texture atlas. The page first sends a HEAD request for `office.glb` and stops with a clear message if it is not there.
- `public/hermes3d/` is gitignored. It is rebuilt from the Synty source packs by the scripts in `scripts/v2/hermes3d/`; `_design/hermes3d/PIPELINE.md` describes the process.
- Settings live in `settings.hermes3d` in the runtime settings store. A `talkingHoldMs` value exists there but nothing uses it yet, so it is not in the gear.
- Seated bodies play idle clips with random start times. If the clips file fails to load, no bodies are seated rather than showing them frozen. If the atlas fails, they render grey and the summary says so.
- WebGL runs only in the browser, so the scene is loaded client side. Scene cost depends on the viewing device; use `lite` on weaker machines.
