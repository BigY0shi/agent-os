# Music

Route: `/music` · UI: `src/components/MusicStudio.tsx`, `src/components/MusicSettings.tsx` · Backend: `src/app/api/music/` (`generate`, `status`, `list`, `save`, `preview`), `src/lib/musicStudio.ts`, `src/lib/suno.ts`

Describe a musical style and Suno composes it, two takes per run. Every track is downloaded to your machine and kept in a History list where you can play, star, rename, download or delete it. Suno has no official public API, so this uses a third-party Suno API with your own key.

## Tabs and controls

The page has a compose panel headed **Hermes Music**, an in-progress panel, and **History**.

### Compose

| Control | What it does |
|---|---|
| **Configure** (gear) | Opens "Music / Suno settings". **Backend**: **Third-party API key** or **Account cookie**. With the key backend: **Suno API key** and **API base URL** (default `https://api.sunoapi.org`). With the cookie backend: **Suno account cookie**, which the hint marks as scaffolded and not yet wired into generation. Saved to the `music` section of `~/.agentic-os/settings.json`. |
| Style box | "Describe the style..." Ctrl/Cmd+Enter generates. |
| **VIBES** chips | **Build the future**, **Flow state**, **Relentless grind**, **Chill to work**, **Deep focus**, **Hustle / 2am**, **Morning momentum**, **Boss level**. Each fills the style box with a preset description. |
| **Title (optional)** | A title for the tracks. |
| **Instrumental** / **With vocals** | Toggle. Instrumental is on by default. |
| Model select | **Suno v5 · newest**, **v4.5+**, **v4.5 · stable** (default), **v4**. |
| **Generate** | Sends the request. Reads **Composing...** while running. |

### In progress

Shown while a run is active: a spinning disc, the phase ("Composing... Suno usually takes 30-90s for two takes", then "First take is in - finishing the second..."), seconds elapsed, and stream players for early previews when Suno provides them. After about 7.5 minutes of polling the page stops waiting and says the tracks will appear in History once they land.

### History

| Control | What it does |
|---|---|
| **All** / **Saved** | Show every track, or only starred ones. |
| Track row | Cover art (or a disc icon), title, duration, tags or style, age, and an audio player. |
| Pencil ("Rename") | Edit the title inline. Enter or the check saves, Escape or the X cancels. |
| Star ("Save" / "Unsave") | Toggles the saved flag on the track. |
| Download | Downloads the MP3 as `<title>.mp3`. |
| Trash ("Delete") | Removes the track: its audio, cover and metadata files move together to `~/.agentic-os/music/.exile/<timestamp>/`. There is no confirm. |

## How it works

- **Generate** posts to `/api/music/generate`, which starts a Suno task and returns its id. The page then polls `/api/music/status` every 5 seconds. When the task finishes, the server downloads each clip's audio and cover into `~/.agentic-os/music/` as `<ts>-<i>-<slug>.mp3`, `.jpg` and a `.json` sidecar with the prompt, style, tags and saved flag.
- History (`/api/music/list`) is built from those sidecars. Audio and covers are served from `/api/music/preview/<file>`, which only serves files inside the music folder.
- Star, rename and delete go to `/api/music/save`. Delete exiles the files (recoverable from `music/.exile/`); a sidecar pointing outside the music folder is refused.
- The Suno key is looked up in this order: the `SUNO_API_KEY` environment variable, `~/.agentic-os/suno.env` (`SUNO_API_KEY=`, optional `SUNO_API_BASE=`), then the settings gear. Without one, generation fails with "Suno API key not configured".
- Generation calls the Suno API over the internet and uses your credits on that service.
