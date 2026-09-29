# Thumbnails

Route: `/thumbnails` · UI: `src/components/ThumbnailStudio.tsx`, `src/components/ThumbnailSettings.tsx` · Backend: `src/app/api/thumbnails/`, `src/lib/thumbnailLog.ts`

Makes YouTube-style thumbnails from reference images and plain instructions. You drop in a current thumbnail, a screenshot or a photo (or nothing), say what to change, and get one to four 16:9 versions back. Generation runs either through a CLI agent's image skill or through OpenAI gpt-image-2.

## Tabs and controls

The page is one panel, with no tabs.

### Settings and input

| Control | What it does |
|---|---|
| **Configure** | The "Thumbnails settings" gear. **Backend** is **CLI agent (image skill)** (the default) or **OpenAI gpt-image-2**. With the CLI backend, **Image agent** picks the CLI agent. **Save** writes them. |
| **1 · Reference images** drop zone | Drop images or click to choose. Up to 6. Optional. |
| Remove (X on a thumbnail) | Removes that reference image. |
| **+ add** | Adds another reference image. |
| **2 · Instructions** | What to change or make. |
| **Versions** 1 / 2 / 3 / 4 | How many versions to make (default 3). |
| **Redesign from scratch** | Off (default) is a faithful edit of your image; on is a full redesign. |
| **Prevent 4-in-1 grid** | On by default. Adds a line that asks for separate single images rather than a collage. |
| **Vary each version** | Off by default. On asks for different layouts, colours and backgrounds per version. |
| **Generate better versions** | Needs a reference image or instructions. Posts to `/api/thumbnails/labs/generate` (CLI backend) or `/api/thumbnails/generate` (gpt-image-2). A timer runs while it works. |

### Results and history

| Control | What it does |
|---|---|
| Result image | Click to enlarge; click outside to close. |
| **Save** | Shown on hover. Downloads that version as `thumbnail-N.png`. |
| **Past thumbnails** | Sessions read from `/api/thumbnails/history`: the instructions, how long it took, the reference images (marked REF) and the outputs. Click any image to enlarge it. |

## How it works

- **CLI backend:** the chosen agent runs one-shot in a temp folder with your reference images and is told to save `thumb-1.png` and so on using its own image skill or MCP (for example Higgsfield). The route reads the files back and returns them. It needs an agent that actually has an image tool; there is no API key involved. The run times out after about 285 seconds.
- **gpt-image-2 backend:** runs `~/.claude/skills/youtube-thumbnails/scripts/generate.py`, one call per version in parallel. It needs `OPENAI_API_KEY` in `~/.claude/skills/youtube-thumbnails/.env`; a rejected key comes back as a named error.
- Only the gpt-image-2 route saves sessions to the Obsidian vault, under `<vault>/Thumbnails/<session>/` with an entry in `Thumbnails Log.md`. **Past thumbnails** lists those sessions, so it is empty without a vault or when you only use the CLI backend.

## Known gaps

- While generating, the page always says "Making N versions with gpt-image-2" and "saving to your Obsidian Thumbnails folder", and when done says "saved to your vault", even on the CLI backend, which does not save anything to the vault.
