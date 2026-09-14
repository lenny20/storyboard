# First build contract

Local-first browser app. Root orchestrator integrates; agents own only assigned directories. The user explicitly requested agents to implement, overriding Sites skill restrictions on implementation delegation. No deployment, external messages, or paid image generation in this build.

## Shared types (domain agent defines in model.ts)

All identifiers strings. Dates ISO strings. Coordinates normalized 0..1.

```ts
type ReferenceKind = 'character' | 'location' | 'prop' | 'style';
interface ReferenceAsset { id:string; name:string; kind:ReferenceKind; dataUrl:string; mimeType:string }
interface ImageVersion { id:string; dataUrl:string; createdAt:string; label:string; prompt?:string }
interface CompositionMarker { id:string; label:string; x:number; y:number; scale:number }
interface PanelArrow { id:string; kind:'camera'|'action'; x1:number; y1:number; x2:number; y2:number; label:string }
interface Panel { id:string; title:string; framing:string; angle:string; description:string; versions:ImageVersion[]; selectedVersionId:string|null; markers:CompositionMarker[]; arrows:PanelArrow[] }
interface Shot { id:string; title:string; description:string; dialogue:string; action:string; camera:string; notes:string; referenceIds:string[]; panels:Panel[] }
interface Scene { id:string; title:string; shots:Shot[] }
interface StoryProject { schemaVersion:1; id:string; name:string; aspectRatio:number; style:string; styleNotes:string; scenes:Scene[]; references:ReferenceAsset[]; createdAt:string; updatedAt:string }
```

## Modules

Domain module draft directory: `implementation/domain/` -> integrate into `studio/lib/storyboard/`.
- model.ts: above types, `createProject(name?:string):StoryProject`, `createScene(title?:string):Scene`, `createShot(title?:string):Shot`, `createPanel(title?:string):Panel`, `getSelectedImage(panel):ImageVersion|undefined`, `cloneShot(shot):Shot`, `validateProject(value:unknown):StoryProject`, `newId():string`.
- storage.ts: `listProjects():Promise<StoryProject[]>`, `saveProject(project):Promise<void>`, `deleteProject(id):Promise<void>`, `exportProject(project):void` browser download, `importProject(file:File):Promise<StoryProject>`, `imageFileToDataUrl(file:File):Promise<string>`. IndexedDB, safe validation, explicit errors, portable backups.
- prompts.ts: `buildPanelPrompt(project,scene,shot,panel):string`; `buildRevisionPrompt(project,scene,shot,panel,instruction):string`; `downloadReferencePack(project,shot):Promise<void>` optional if zip library available; otherwise UI can offer individual reference downloads. Deterministic assembly, exact direction, selected refs, only relevant shot data, no paid LLM parsing. Include optional composition markers and labelled arrows. Distinguish dollies and zooms.

PDF module draft directory: `implementation/pdf/` -> integrate into `studio/lib/pdf/`.
- export.ts: `createStoryboardPdf(project:StoryProject, options?:{sceneId?:string}):Promise<Uint8Array>`. Import shared types from `../storyboard/model` in final location (draft relative path unresolved until integration).
- Entire project or one scene; A4 portrait; modern editorial grid; 2.39 and configurable ratios; images, labelled overlays, captions, shot dialogue once; robust long text/long shot pagination. Embedded redistributable font if practical; otherwise reliable PDF standard fonts acceptable for first implementation. No macOS-specific runtime fonts.
- Browser-capable library expected `pdf-lib`. Return bytes, do not force download (UI owns preview/download). Caller can create PDF blob and download. Error on malformed images with actionable message, or deliberate missing-art frame for empty panels.

Editor draft directory: `implementation/editor/` -> integrate into `studio/components/storyboard/`.
- Main `StoryboardApp.tsx` default client React component and `storyboard.css`, imports `@/lib/storyboard/{model,storage,prompts}` and `@/lib/pdf/export`.
- Visual theme: polished dark graphite working surface, off-white image canvas, warm amber/ochre active accent; no marketing page. Clear 14px+ controls. Match approved workflow, refine visual design.
- Projects, scene selection, top shot strip, shot/panel editing, reorder/duplicate/delete, editable direction/dialogue/action/camera/notes, references upload/selection, selected image import/drag-drop replacement/history, prompt/revision export, simple optional composition markers and arrow notes, project settings, autosave status/errors, portable backup import/export, PDF preview/download.
- Use scaffold shadcn primitives where applicable. Root will send paths after scaffold. For early draft use semantic HTML for working core then integrate primitives as required. Avoid adding simulated AI Generate or dead controls. No API key input unless actual API integration implemented (not planned initially).
- Preserve edits across navigation, async imports, and reload. Accessible button labels, keyboard form operation, responsive layout. Starter data uses user's example shot descriptions; no invented character art or dialogue.

## Validation and delivery

Root reviews and integrates. Domain tests validate roundtrip/error cases and cloning IDs. PDF stress fixture covers long dialogue, multi-page shot and missing/real artwork; render output and inspect pages. UI compile and appropriate checks; no claim of image model quality validation. Local operation, startup instructions, first useful view opened in Codex, no hosting registration.
