# Storyboard PDF export

`createStoryboardPdf(project, options?)` returns A4 PDF bytes and is safe to call
in the browser. The caller owns previewing or downloading those bytes.

```ts
createStoryboardPdf(project, {
  layout: 'portrait-2up', // or 'landscape-2up', 'landscape-3up'
  sceneId: 'scene-id', // export one scene
  includeNotes: false, // production notes, off by default
  includeCover: true, // the cover page, on by default
  sceneBreaks: 'flow', // or 'page', to start every scene on a new page
});
```

The design is fixed by `design/pdf-export-spec.md`. Read that for the numbers;
this file says how the code is arranged. Where the two disagree, the spec wins.

## What it looks like

Every page is charcoal, edge to edge. Large frames, one accent colour, one type
scale, no frame borders and no boxes. A cover page carries the title and a
contents list. Board pages carry a running header, a footer with the page
number, and a column of blocks: scene bands, shot headings, rows of frames and
their captions.

Camera moves and shot transitions are drawn as **rails**: a thin accent line
under a row of frames, with a circle at the source, an arrowhead at the
destination, the endpoint names at each end, and the move type and description
knocked out over the middle. A move whose two frames sit in different rows wraps
like a line of text, with `(to B)` at the right edge of the source row and
`(from A)` at the left edge of the destination row.

## Modules

| File | Responsibility |
| --- | --- |
| `export.ts` | Public API. Validates, embeds fonts and artwork, runs the plan through pagination, draws each page, inserts the cover. |
| `theme.ts` | The colour tokens and the complete type scale. Nothing else picks a size or a colour. |
| `geometry.ts` | Page size, margins, columns and the body bounds, per layout. |
| `text.ts` | Measuring, wrapping, letter spacing, and the unsupported-glyph error. |
| `dialogue.ts` | The screenplay grammar that sorts dialogue lines into cues, parentheticals and spoken lines. |
| `blocks.ts` | Measuring and drawing: captions, frames, shot headings, scene bands, the running header and the footer. |
| `rails.ts` | Rail geometry, chain junctions and label wrapping. |
| `plan.ts` | Walks the project into blocks: row packing, shot codes, panel letters, and which connections draw. |
| `pagination.ts` | Assigns blocks to pages. Rows never split, headings are never orphaned, pages fill. |
| `cover.ts` | The cover page and its contents list. |
| `format.ts` | Dates, aspect ratios and middle-dot joins. |

Everything is measured before anything is drawn. A block reports its height, so
pagination decides page breaks without touching a page. Rail heights come from
the row structure, which is settled before pagination, so a rail never changes
size because of where its row lands.

## Artwork

`artwork.ts` groups identical selected data URLs, encodes each source once for
its largest printed use, then shares that PDF image across panels while keeping
their individual transforms. `image-encoding.ts` resolves crop and zoom
placement before downsampling to roughly 200 DPI; it never upscales a source.
Transparency flattens to the frame's black ground. The cover image is encoded
separately, because it is drawn full bleed and needs far more resolution than a
panel frame. Node has no raster APIs, so exports made there keep native PNG and
JPEG bytes and are much larger than the same export from a browser.

## Fonts

Barlow Condensed, Barlow and Courier Prime, bundled under `fonts/` with
provenance and checksums in `fonts/README.md`. They load through
`fetch(new URL('./fonts/…', import.meta.url))`, so there is no OS font or server
dependency. A character outside their coverage raises an actionable export error
rather than silently changing the written material.

## Reviewing a render

For visual review of a saved project without changing it, copy its manifest and
the selected scene's image assets to a temporary snapshot folder, then run:

```sh
cd /Users/rocklobster/Projects/storyboard/studio && node --import tsx tests/render-project-review-pdfs.mjs <snapshot-folder> <scene-id> <output-folder>
```

This renders all three layouts. Keep private artwork out of permanent fixtures,
and remove the temporary snapshot and rendered review files after inspection.

Integration dependency:

```sh
cd /Users/rocklobster/Projects/storyboard/studio && npm install pdf-lib @pdf-lib/fontkit
```
