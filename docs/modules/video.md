# Video

Route: `/video` · UI: `src/components/VideoStudio.tsx`, `src/components/VideoDirector.tsx`, `src/components/VideoSettings.tsx` · Backend: `src/app/api/video/`, `src/lib/heygen.ts`, `src/lib/elevenlabs.ts`, `src/lib/videoProjects.ts`, `src/lib/videoWorkspace.ts`

A video workbench. The Director takes a topic through research, an editable script, a presenter or voiceover, per-scene b-roll and an automatic edit into one MP4. Create renders an HTML motion composition from a prompt, Avatar makes a single talking-head clip, and Workspace browses the finished files.

## Tabs and controls

**Director**, **Create**, **Avatar** and **Workspace** are the tabs. Director is the default.

### Director

A stepper shows **Brief**, **Research + Script**, **Avatar + B-roll**, **Edit + Render**, **Output**. The run is kept in this browser, so a reload resumes it.

| Control | What it does |
|---|---|
| Topic box + mic button | What the video is about. The mic dictates into the box. Ctrl+Enter writes the script. |
| **See an example** | Shown when `/api/video/auto/example` has one. Loads a finished example video into the Output step. |
| **Write the script** | Posts to `/api/video/auto/script`. The Claude CLI researches and writes it; if Claude is unavailable, a local Ollama model drafts it and the script is tagged "drafted · local". |
| **Configure** | The "Video labs settings" gear. **Backend** is **Eidolon LTX/WAN** (with **Model**: **LTX-Video** or **WAN**, **Eidolon Studio endpoint**, **ComfyUI endpoint**) or **CLI agent + Higgsfield** (with **CLI agent**). **Save** writes them. |
| **Length** slider | 15 seconds to 10 minutes, in 15-second steps (default 40s). |
| **Narrator**: **Presenter** / **Voiceover** | A HeyGen avatar lip-synced to the voice, or voice only. |
| **B-roll engine**: **Eidolon** / **Agent** / **MiniMax** / **Grok** | Eidolon and Agent go to `/api/video/labs/generate`; MiniMax and Grok go to `/api/hermes/studio/generate`. |
| **Avatar (lip-synced to the voice)** | Presenter mode only. Your HeyGen avatars. |
| **Voice · ElevenLabs** | Your ElevenLabs voices. |
| **Brand / outro** | Brand text for the edit (default "Agent OS"). |
| Script step: title, per-scene caption, narration line and b-roll prompt | All editable before generating. Research notes are listed on the right. |
| **Generate avatar + b-roll** | Makes the ElevenLabs narration, sends it to HeyGen (Presenter) or keeps it as the voiceover, and starts one b-roll clip per scene. |
| **← Brief** / **Rewrite** | Go back, or write the script again. |
| **retry** (on a failed b-roll tile) | Regenerates that scene's clip. |
| **Assemble + render** | Enabled once audio and every b-roll clip have finished or failed, with at least one usable. Posts to `/api/video/auto/assemble`, then starts a HyperFrames render. |
| **Preview the live composition** | While rendering, opens the HTML composition. |
| **Download MP4** / **New video** | On the Output step. |

### Create

| Control | What it does |
|---|---|
| **What video do you want?** + **Create + render** | Posts to `/api/video/hyperframes/init` to scaffold an HTML composition from the prompt, then to `/api/video/hyperframes/render`. Ctrl+Enter also launches. |
| **Projects** list + refresh icon | Your HyperFrames projects. Click one to preview its last render. |
| **Render again** / **Download** | On a selected project. |
| **Render history** | The last 10 render jobs. Click one to see its status, log tail and output. |

### Avatar

| Control | What it does |
|---|---|
| **Search avatars...** + avatar grid | Your HeyGen avatars; click to select. |
| **Search voices...** + voice list | HeyGen voices; click to select. |
| **Script** | Up to 8000 characters. |
| **Generate** | Needs an avatar, a voice and a script. Posts to `/api/video/heygen/generate`, then polls status every 5 seconds. |
| **Save** | Downloads the finished clip. |
| **Avatar history** | The last 12 clips, kept in this browser. Click one to reload it. |

### Workspace

| Control | What it does |
|---|---|
| **Finished Videos**, **Downloads**, **Desktop** buckets + refresh icon | Finished Videos is `~/.agentic-os/video-projects`; the other two list MP4s at the top of `~/Downloads` and `~/Desktop`. |
| File row | Opens the file in the preview pane (video, audio, image, HTML, text or JSON). |
| **Preview** / **Source** | For HTML files. |
| **New tab** / **Save** / close | Open, download or close the preview. |

## How it works

- Keys: HeyGen from `HEYGEN_API_KEY` in `~/.agentic-os/heygen.env` (avatar and voice lists are cached for 24 hours in `~/.agentic-os/heygen-cache`); ElevenLabs from `ELEVENLABS_API_KEY` in the active Hermes profile `.env` or the environment.
- Projects and renders live in `~/.agentic-os/video-projects/`.
- Rendering runs the HyperFrames CLI from a fixed path, `~/local/node/bin/hyperframes`. If it is not there, the render route answers 503 "hyperframes CLI not found".
- Long jobs are polled from the browser; a Director render keeps going if you leave the page.

## Known gaps

- A failed b-roll clip shows its error on its tile whatever the engine (Grok is no longer retried on MiniMax behind your back); use the tile's retry.
- The Director always narrates with ElevenLabs; there is no control for the MiniMax voice path the code also supports.
- In Workspace, **Source** on an HTML file shows its markup (up to 200 KB).
- The Create hint says a render starts automatically and takes 30 to 90 seconds; that depends on the CLI path above existing.
