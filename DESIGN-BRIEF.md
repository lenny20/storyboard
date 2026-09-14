# Storyboard tool — working design brief

Updated 10 September 2026. Discovery draft for Big Trimpy; proposed defaults are not all confirmed requirements. No production app or image-generation integration has been built.

## Purpose and success

Help a writer transitioning into directing translate a clear shot vision into readable storyboards without drawing. First use: a three-minute teaser for an animated feature intended for a high-end finished animation pipeline combining artists and AI. The boards themselves should be rough pencil sketches.

Success means a scene whose framing, angle, shot type, action, camera movement, and dialogue accurately communicate the director's intention, delivered as a printable PDF. Exact character likeness and detailed faces are unnecessary. Silhouette, proportions, costume, placement, and staging matter where relevant.

## Confirmed preferences

- Mac is suitable; Linux is acceptable; Windows and tablet support are unnecessary initially.
- The editor design is accepted in principle. A compact strip of neighbouring shots above the editor is confirmed, preserving scene context while refining one shot.
- PDF output must be aesthetically polished and seamless: the tool handles page composition, typography, spacing, shot grouping, and pagination, with no manual cleanup in a separate layout app.
- Export art direction: elegant, modern, and visually striking through disciplined typography, deliberate white space, large cinematic panels, restrained metadata, and consistent alignment. This is a core quality requirement, not optional final polish. Avoid app-interface styling on paper, decorative boxes around captions, heavy table grids, and tiny text used to force content onto a page.
- Describe each shot in natural language, within scenes, then enter dialogue manually. A full script can provide optional context.
- Minimal creative initiative: translate the director's choices. Do not invent coverage, rewrite dialogue, or select shots without direction.
- Existing character illustrations and 3D renders cover multiple angles. No expression sheets. Location art, photographs, and other references are available in limited quantities.
- Most compositions are simple, with occasional precision requirements. Simple placement aids are welcome if testing shows they improve generation.
- The director specifies camera moves and acting changes. Multiple panels can describe successive moments in one shot.
- Stills and printable PDF are the first delivery target. No animatic, audio playback, or video export needed.
- Dialogue probably belongs beneath the whole shot; the director delegates the detailed layout decision.
- Prompt-based revisions, one selected version with automatic history, and duplicate-shot alternatives are accepted.
- Generated images must be replaceable with user-supplied images without losing written shot information.
- ChatGPT Pro is available. Exporting prompts from the tool and generating images manually in Codex is acceptable.
- Optional API generation is acceptable if economical: cents per image, ideally fractions of a cent, while preserving sufficient quality. No dollar-per-image workflow. Roughly a minute of waiting is comfortable; this is not a latency guarantee.

## Proposed first version

1. Local-first, desktop-focused editor with project → scene → shot → panel structure.
2. Project style and aspect ratio, reference library, and per-shot reference selection. Provisional ratio: 2.39:1, editable before boarding.
3. Natural-language shot description plus editable framing, angle, action, and camera fields. Parsing mechanism remains unresolved; simple structured fields and deterministic prompt assembly can work without a text API.
4. One or more ordered panels per shot. Explicit start/end frames for a move; director can insert intermediate moments.
5. Dialogue once per shot, with speaker names where supplied. Optional panel-specific action notes. Preserve exact written dialogue.
6. Separate artwork, captions, and camera/action annotation overlays. Movement arrows have explicit labels; inter-panel ordering alone does not define movement.
7. Generate a copyable prompt and a list of reference files to attach. Import or replace each returned image manually. The tool must not imply references were sent automatically.
8. Prompt revisions with previous versions retained; selected image and alternatives distinguished. Duplicate shot for creative branches.
9. Optional composition markers for position and scale. Treat their usefulness as a hypothesis; neither prompt instructions nor markers guarantee exact composition.
10. PDF preview and export, preserving shot grouping, legible captions, scene/shot/panel identifiers, project title, and revision date. Split long shots across pages with continuation labels; never shrink dialogue to fit or duplicate it ambiguously.
    Default print proposal: A4 portrait, generous printer-safe margins, monochrome typography and artwork, subtle rules, and a clear hierarchy from project to scene to shot to panel. Fit one or two panels per row at a readable size. A4 is a design default, not a confirmed paper preference. Keep captions with their panels and shot-level dialogue once per shot. Omit unused fields. Preserve aspect ratio; cropping must be explicit. Embed fonts and keep text/vector annotations sharp. The layout sample is a design proof, not a finished general-purpose exporter.
11. Autosave, undo for routine edits, portable project backup containing art and metadata. Individual-image export is useful but PDF is the confirmed priority.
12. Optional API path after a cost/quality comparison. Expose estimated and actual spend; use explicit quality/size, one candidate by default, and a project spending limit. Do not automatically upscale or retry repeatedly. Do not silently transmit an optional full script when a shot's context suffices.

These are design recommendations, not verified implementation capabilities. Initial inline mockup demonstrates panel selection, prompt preparation, dialogue editing, and a print layout; artwork is explicitly placeholder content. It is not an image quality test or a finished PDF.

## Example shot

Director input: “Mid on Matilda, middle of frame, dollying into closeup as she smiles.”

- One continuous shot, two initial panels.
- A: medium framing, Matilda centred. Starting expression is unspecified.
- B: close-up framing, Matilda centred, smiling.
- Camera: dolly forward, not a substituted zoom. Camera angle, setting, eyeline, and exact motion path are unspecified until the director supplies them or intentionally leaves them flexible.
- Dialogue: empty until entered by the director.
- Both panels use the selected character/style references. No references have been supplied in this design session.

Second test example: “Aerial of a small island in a vast ocean, flying through wispy clouds.” Clarify direction and relevant start/end beats only if needed; do not invent an elaborate sequence.

## Generation and cost

Manual Codex generation is the default design path, using the existing subscription subject to its limits. A separate application must not assume that a ChatGPT subscription is an image API entitlement.

Official published GPT Image 2 examples at 1536 × 1024 list image output costs of US$0.005 at low and US$0.041 at medium quality. These are comparison figures for an earlier model, not a chosen provider, current-model quote, or an all-inclusive 2.39:1 estimate. The current GPT Image 2.5 guide recommends its newer models for new integrations and prices inputs/outputs by tokens. Reference input tokens, text input, optional text-model processing, and revisions add to spend.

Economics must be evaluated per accepted panel. Example arithmetic only: 100 accepted panels × 3 attempts × US$0.005 output = US$1.50 in image output charges, before input and other charges. Low image quality is a model setting, not a synonym for pencil style; artistic simplicity does not guarantee cheaper or sufficiently accurate output.

No API requests have been made and no API costs have been incurred in this discovery work. Before implementation, verify account model availability, actual 2.39:1 cost, reference handling, and a supported secure credential path. The user is open to an economical trial; use a small bounded comparison, not a broad batch.

## Validation before committing to generation controls

Use supplied references to compare a simple centred character shot, the two-panel dolly, and one precise blocking shot. Judge composition, recognisability, acting readability, reference continuity, and revision fidelity. Log actual cost and latency for each attempt and cost per accepted panel. Compare plain prompts with simple composition guides on the precise shot. Do not require detailed faces to pass.

Review one representative PDF page with the director before expanding export layouts. Check cinematic framing, dialogue readability, long shot handling, and unambiguous camera/action labels.

## Deferred

Animatics, audio, video generation, automatic coverage proposals, deep drawing tools, 3D staging, team accounts, collaborative review, payments, and commercial release. Additional image styles remain part of the broader vision; pencil is the first acceptance case. No final product name has been chosen.

## Research basis

Industry practice varies by production. Toon Boom distinguishes animation scene terminology from live-action shot terminology; the tool can use the writer's familiar scene/shot/panel hierarchy while maintaining clear identifiers. Multiple panels depict acting/action beats within a shot. Captions and camera moves must remain editable independently of art.

- [Toon Boom: storyboard structure](https://docs.toonboom.com/help/storyboard-pro-20/storyboard/structure/about-storyboard-structure.html)
- [Toon Boom: captions](https://learn.toonboom.com/modules/intro-to-storyboarding/topic/what-are-captions)
- [Toon Boom: camera moves across panels](https://docs.toonboom.com/help/storyboard-pro-20/storyboard/camera/about-camera.html)
- [Toon Boom: export workflows](https://docs.toonboom.com/help/storyboard-pro-25/storyboard/getting-started/export.html)
- [Disney: story process](https://www.disneyanimation.com/process/story/)
- [Disney: layout](https://www.disneyanimation.com/process/layout/)
- [OpenAI: subscription authentication](https://learn.chatgpt.com/docs/auth)
- [OpenAI: built-in image generation and usage](https://learn.chatgpt.com/docs/image-generation)
- [OpenAI: image generation, pricing, and limitations](https://developers.openai.com/api/docs/guides/image-generation)
