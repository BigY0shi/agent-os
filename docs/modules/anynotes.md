# AnyNotes

Route: `/anynotes` · UI: `src/components/v2/anynotes/` (`AnyNotesView.tsx`, `CaptureBox.tsx`, `NoteCard.tsx`, `NoteDetail.tsx`, `AnyNotesSettings.tsx`) · Backend: `src/lib/v2/anynotes/` (`capture.ts`, `store.ts`, `jarvisReply.ts`, `ingest.ts`, `attention.ts`), `src/app/api/anynotes/`

A capture inbox. Paste a tweet, article or video link, drop or paste a screenshot, or type a quick note. Each capture becomes a card with a text snapshot, and each note has its own reply thread where you can mention @jarvis to get an answer about it.

## Tabs and controls

One page: header, capture box, filter row, a grid of note cards, and a detail drawer.

### Header

| Control | What it does |
|---|---|
| Count chips | **inbox N**, **kept N**, **archived N**, counted by the server. |
| **Configure** (gear) | Opens "AnyNotes settings" (see below). |

### Capture box

| Control | What it does |
|---|---|
| URL field | "Paste a tweet, article or video URL..." Enter captures it. |
| **Capture** | Captures the URL. |
| **Note** | Opens a plain-text area ("the first line becomes the title") with **Save note**. |
| Paste or drop an image | Pasting an image or dropping a file anywhere on the box captures it as a screenshot. PNG, JPG or WebP, up to 20 MB. |
| **Bookmarklet** | Opens "Capture from your browser" with a `javascript:` bookmark snippet and **Copy bookmarklet**. Clicking that bookmark on any page opens `/anynotes?capture=<page url>` and captures the page. |
| Error / warning lines | Red when a capture failed. Amber when extraction failed but the note was saved with just the link. |

### Filters

| Control | What it does |
|---|---|
| **inbox** / **kept** / **archived** / **all** | Status filter. Starts on inbox. |
| Type chips | **Tweet**, **Article**, **Video**, **Screenshot**, **Note**. Click to filter by one, click again to clear. |
| Label select | **all labels**, or one label taken from the notes currently loaded. |
| Search | "search title, text, url". |

### Note cards

Each card shows the type, status, a preview, labels, a reply count, and an amber marker when extraction was degraded. Click a card to open its drawer (`/anynotes?note=<id>`). Hover actions: **Keep**, **Archive**, **Back to inbox** (each hidden when the note is already in that status), and **Open source** when the note has a URL.

### Note drawer

| Control | What it does |
|---|---|
| Source line | Status, site and author, capture time, and **open source** when there is a URL. |
| **inbox** / **kept** / **archived** | Moves the note to that status. |
| **Exile** | After a confirm, moves the note (and its replies) into the `anynotes_exile` table. It is recoverable, not deleted. |
| Labels | Click the x on a label to remove it; type in **+ label** and press Enter to add one. |
| Snapshot | The screenshot, and the captured text as Markdown. If nothing was captured it says "only the link". |
| **thread** | Your replies and Jarvis replies. A pending Jarvis reply shows "Jarvis is thinking...", a failed one shows its error in red. |
| **@jarvis** | Adds `@jarvis` to the start of your draft. |
| **Reply** | Posts your reply. If it mentions @jarvis, a Jarvis reply is generated in the background. |

### Settings (gear)

| Control | What it does |
|---|---|
| **Ingest captures into Memory** | Checkbox "Queue captures + exchanges into Memory V2". On by default. When on, every capture and every finished @jarvis exchange is queued into Memory with the `anynotes` and type labels. Saves immediately. |
| **Jarvis agent** | Which CLI agent answers @jarvis replies. Default `claude`. Saves immediately. |
| **Default status for new captures** | inbox, kept or archived. Saves immediately. |
| **Max snapshot characters** | Cap on stored snapshot text, 500 to 200000, default 24000. Longer text is cut with a visible marker. Saved with the Save button. |

## How it works

- Notes and replies live in the Agent OS SQLite database, `~/.agentic-os/agentos.db` (tables `anynotes`, `anynote_replies`, plus `anynotes_exile` and `anynote_replies_exile`). Screenshots are saved under `~/.agentic-os/anynotes/media/` and served from `/api/anynotes/media/<file>`.
- Capturing a URL: tweets go through Twitter's public oEmbed endpoint, YouTube videos through YouTube's oEmbed, and articles are fetched and run through Mozilla Readability, with an Open Graph fallback. If extraction fails, the note is still saved as a link-only note and the route answers 422 with the reason, which the page shows as a warning.
- @jarvis replies go through `cliComplete()` with the chosen CLI agent and your own login. There is no fallback model: if the agent fails, the error is written to the reply and shown in red. A finished Jarvis reply also raises an attention flag that links back to the note.
- The page and the open drawer poll every 4 seconds while visible.
- Settings live in the `anynotes` section of `~/.agentic-os/settings.json` and are read on each request.
