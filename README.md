# Storyboard Studio

A personal storyboard workspace for Big Trimpy: describe shots, organise panels, attach references, prepare generation prompts, bring in artwork, and export a designed PDF.

## Open the app

On this Mac, open **Start Storyboard.command**. The launcher checks the app identity, rebuilds changed source when needed, and waits until it is ready at **http://127.0.0.1:4317/**. Keep its terminal window open while working; Control-C stops the server. Use the same address and browser profile each time to access the same saved projects. The Codex embedded browser and your usual browser have separate storage; use a project backup to transfer work between them.

For Linux or manual startup, use Node.js 22.13 or newer:

```sh
cd studio
npm ci
npm run build
npm start
```

## Working with a scene

1. Open the sample Teaser or create a project. Set the frame ratio and image style.
2. Add scenes and shots to organise your sequence. Each panel has its own dialogue, camera direction, context, and notes; describe what happens in the panel in its Frame direction. Connections between timeline items carry transitions and movements.
3. Add panels for moments within the shot. Each new panel starts with a blank **Frame direction**. Describe that frame in Direction or Generate, and set framing and angle when useful. A new image requires its own frame direction; existing shared text is preserved as independent panel values when older projects are opened. Clearing one panel does not clear its neighbours.
4. Open Reference library and add named characters with their reference views. The library is shared across all scenes in this project. Select the characters or other references each panel uses. Selecting a named library entry includes its views, including views added later.
5. Use **Generate** to connect an OpenAI API key and generate one image with the selected references. Or download the panel's generation pack, unzip it, paste its prompt into Codex or ChatGPT, and attach the included images.
6. API results are added to the originating panel. For manual generation, import or drop the result into its panel. Replacing artwork keeps the shot information and earlier image versions.
7. Preview the PDF, then download it for printing or handing to artists. **Page layout** offers portrait with two frames across, or landscape with two or three frames across. Pages are charcoal with large frames on a strict grid; the design is documented in `design/pdf-export-spec.md`. Frames default to the smaller size. Select **Panel details → Full-width in PDF** on an individual panel to give it a large frame. Each shot opens with a large numeral such as **2.01**; panels are lettered A, B, C beneath their frames. Camera moves are drawn on a thin rail under the frames, reading **A ———▶ B**; when the next frame is on a following row or page the rail reads **A ———▶ (to B)** and continues as **(from A) ———▶ B**. Long dialogue and directions receive more room without shrinking the type. Character cues are written in capitals on their own line above the dialogue and print in the accent colour; dialogue uses embedded Courier Prime. Footers show the draft label, date, ratio and the page number. Production notes are omitted by default; enable **Include production notes** in the preview when the handoff needs them. The cover page is included by default; uncheck **Include cover page** to leave it out. **Scene breaks** defaults to **Flow**, keeping scenes running together across a page; choose **New page per scene** to start each scene on its own page. **Project settings → Cover** holds the subtitle, draft label, director, production and contact printed on the cover.

Editor shot codes include their scene: **SC03 · SH04**. Shots with multiple drawings add panel letters (**SC03 · SH04 · A**, **SC03 · SH04 · B**); a single drawing has no letter. In the PDF, the heading spells out **Scene 03, Shot 04**, with a compact **S03-04** or **S03-04A** code beneath the artwork. These are draft positions and update when items are reordered. Custom titles and internal IDs remain separate. See [naming conventions and research](NAMING-CONVENTIONS.md).

Open **Panel details** beneath the dialogue to edit the panel name, framing and angle. Framing and Angle show every preset, **Not set**, and **Custom value…** for your own wording. **Clear panel details** removes all three optional values from the selected panel and its PDF captions; the frame identifier remains. Dialogue, direction, artwork and the full-width setting are preserved, and Undo restores the cleared details in one step.

Camera movement choices include **Aerial**, alongside Dolly, Pan, Tilt and the other moves. These labels start with a capital letter in selectors and timeline connectors. PDF descriptions are centered beneath their arrows. Connections within a row use solid arrows. Across rows or pages, short dotted cues at the source's right and destination's left repeat the movement or transition and its description. Row dividers keep these cues and the preceding dialogue distinct from the next row.

PDF artwork is optimized for its printed size, including any crop or zoom, at approximately 200 DPI. Identical selected images are embedded once, and larger artwork is compressed for sharing and printing. Original project images remain unchanged. Full-width frames put dialogue and camera text below their headings; running page headers stay subtle.

New projects use **Rough blocking sketch**: a one-to-two-minute thumbnail sketch by a professional storyboard artist, using confident gestures, primitive shapes, faceless figures and sparse backgrounds without rendering or surface detail. Apply this preset in project settings to an existing project. The previous default rough-pencil styles also receive the stricter sketch instructions for future generation and revision. Detailed character references contribute silhouette, proportions and staging rather than their polished finish. Custom styles remain available.

Use **Image framing** beneath an image for **Fit**, **Crop to fill**, scale, horizontal/vertical position, **Flip H**, **Flip V**, and **Reset**. You can also drag the artwork inside its frame. These edits belong to the selected image version and can be undone; original image bytes are preserved. Canvas thumbnails and PDFs use the same framing. API revision images, selected previous-panel references, and manual generation packs receive temporary framed copies, so the generator sees your chosen composition. New image versions start with default framing.

Selecting a style changes the generated prompt; it does not restyle an imported image automatically. Manual generation remains available alongside the optional paid API connection.

For continuity, open **Generate → Previous panels** (also available in **Prompt**) and select an earlier frame's thumbnail from this scene. The exact chosen image version travels with the next request or generation pack alongside your character/location artwork. Describe what changes in **Frame direction**. Selections are saved per panel; adding a panel starts with none selected.

Use **Add panel** for another moment within the same continuous shot, such as the start and end of a dolly. A cut starts a new shot within the same scene. If the following images are already panels in your current shot, select the last panel before the cut and choose **Start a new shot after this panel**. This moves the following panels into a new shot, preserves their artwork and direction, and can be undone.

Click between two shots to set their transition, camera movement, or both. For example, choose **Cut** and write “Cut when the cloud fully obscures the frame,” or combine **Match cut** with **Dolly**. Click between two panels to describe the movement connecting those moments. Ordinary cuts need no setup. These connections are editorial instructions and remain separate from image-generation prompts.

Drag shots or panels in their strips to change their order, or use the earlier/later controls. Connections belong to their original pairs: moving an item away does not attach its old cue to an unrelated neighbour. Restoring the original adjacency brings its saved connection back. Reordering can be undone.

Select a panel and choose **Delete panel** beside its strip. The confirmation names the panel being removed. Undo restores its artwork, direction and connections. Deleting a shot's last panel keeps the empty shot, where **Add panel** starts a new frame.

Existing reference uploads can be organised into library entries without re-uploading. References and character notes guide future generation; they do not alter existing artwork or guarantee exact character consistency. See [Reference workflow](REFERENCE-WORKFLOW.md).

## Optional OpenAI generation

Open a panel's **Generate** tab and paste your own API key into the password field. **Save key locally** keeps it in the local server's memory until the server stops. The key is excluded from projects and backups. For persistent configuration, copy `studio/.env.example` to `studio/.env.local`, enter the key there, and restart the launcher; that file is ignored by Git. An environment key takes precedence over a session key.

The default is **GPT Image 2.5 Flare, medium quality**, with the output size chosen to match your project's frame ratio. Choose Low for quick drafts or High for more detail. Your quality choice stays selected as you move between panels during an editing session. Selected reference artwork is attached automatically with every request. Revision mode also attaches the current panel image. Requests generate one image at a time, and a result returns to the panel where it was started even if you navigate elsewhere. Earlier versions remain available.

The app shows a dated USD rate card before generation and an estimated cost calculated from returned token usage afterward. A reliable fixed total is not available before a request. Missing usage and uncertain charges are shown separately, never assumed to be zero. API billing is separate from a ChatGPT subscription. Check the provider's usage dashboard for invoiced charges; the app's ledger only covers requests made through this local app.

The local usage ledger survives server restarts in `studio/.local-data/`. Recent generated images are retained in `studio/.local-data/openai-results/` for recovery. After each successful image write, the server keeps the newest files within both limits: 25 files and 250 MiB. There is no fixed time expiry, and retained files survive restarts. Use **Result** to download a retained image if its response or project save was interrupted. Requests are never automatically retried after a timeout. Keep important results in your project and backups, since older recovery files are pruned when those limits are reached. This folder is a recovery cache, not a complete project archive.

## Saving and backups

In **New project**, use **Choose folder** (or enter an absolute folder path). The app creates a new child folder named after the project, containing `project.storyboard.json` and an `images/` directory. The project file stores the editable direction, image-version selections, framing and relative image references; the images are ordinary PNG/JPEG/WebP/GIF/AVIF files named by their content hash. Keep the whole folder together when moving or copying it.

Folder projects autosave there, and **Save**, **Save now**, or **⌘S** (**Ctrl+S** on Linux) can request an immediate save. Generated images are also written straight to the project folder by the local server, before the generation response returns; if that write fails, the completed image is preserved and a warning appears. Reference uploads and every image version save with the project. Removing a panel or version does not delete its original image file from the folder.

Use **Open project folder** to reopen a project after moving it or on a different browser profile. The app remembers open folders across server restarts in `studio/.local-data/project-folders.json`. **Close project** removes it from the workspace while preserving all files on disk. Existing browser projects can use **Project settings → Save project to folder**. The macOS chooser is native; Linux can use Zenity/KDialog when installed, or enter the folder path manually. This feature uses the local app server and does not require browser File System Access support.

Leave the folder blank when creating a project to retain browser-only saving. For those projects, references and image versions save to this browser's local IndexedDB database, `storyboard-studio`. Image payloads live in a separate deduplicated asset store; saved project metadata refers to those assets, so editing dialogue does not rewrite all the artwork. Existing projects migrate on their next successful save. Removed image assets are currently retained in the browser database; removing a panel reduces the project's working size but does not immediately reclaim browser disk space. When you explicitly generate through the API, the panel prompt and selected images pass through the local server to OpenAI. Editing the same project in two tabs produces an explicit conflict instead of overwriting work; download the local copy before reloading the saved version. Export a **`.storyboard` project backup** to keep a portable archive of the document and all its images. Import that backup to restore or transfer it. Legacy JSON backups remain importable.

Downloads may open a macOS Save dialog, depending on browser settings. Complete that dialog to save the file. The app retains an explicit download link if the initial request does not start. Chrome backup and PDF delivery have been verified; use your usual desktop browser for production work and keep its profile consistent.

Clearing browser site data clears browser-only projects; it does not remove folder project files. PDF files contain the presentation; project backups preserve the editable work. Images can be up to 20 MB each. Browser-only projects have a **2 GiB working limit**, shown in settings; image uploads are checked before they are added. This is an app limit, not reserved disk space. The browser controls the actual available quota, which settings reports separately when available. Folder artwork uses the chosen disk instead of the browser image database and is exempt from that 2 GiB working limit. Portable `.storyboard` archives support up to 2 GiB; legacy JSON imports retain a 512 MiB limit. Large-project performance also depends on available memory, because the editor currently loads project artwork into memory.

## Development

```sh
cd studio
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

The app lives in `studio/`; `DESIGN-BRIEF.md` records the agreed direction. `design/` contains the early print-study script and specification, separate from the app's PDF exporter. Generated PDFs and review images are excluded from Git. The relative `implementation/domain/node_modules` link lets the legacy domain tests use the dependencies installed in `studio/`.

The app prioritises editable shot data, manual or single-frame API generation, and polished still PDFs. Image-quality benchmarking with your actual references, animatics and collaboration remain future work.
