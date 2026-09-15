# Storyboard PDF export — design spec v2

Updated 15 September 2026. Agreed with Lenny from the mockup canvas
"Storyboard Export Directions" (merged direction: layout of A, visual design
of B). This document is the source of truth for the rebuilt exporter in
`studio/lib/pdf/export.ts`. Where it disagrees with the current code, the code
changes.

The reader's reaction should be "these people are professionals": large
cinematic frames, one disciplined type system, one accent, no app chrome, no
repeated labels, no half-empty pages.

## 1. Units and page

All sizes below are PDF points (pt). The mockup was authored at 96 px per inch;
1 px = 0.75 pt.

| Layout | Page | Side margins | Top margin | Bottom margin | Columns | Column gap |
| --- | --- | --- | --- | --- | --- | --- |
| `portrait-2up` (default) | A4 portrait 595.28 × 841.89 | 36 | 30 | 26 | 2 | 10.5 |
| `landscape-2up` | A4 landscape 841.89 × 595.28 | 36 | 28 | 24 | 2 | 10.5 |
| `landscape-3up` | A4 landscape | 36 | 28 | 24 | 3 | 10.5 |

Content width = page width − 2 × side margin. Frame width = (content width −
(columns − 1) × gap) / columns. Frame height = frame width / project aspect
ratio. A full-width frame spans the content width.

The whole page is painted charcoal, edge to edge. There is no page tint, no
frame border and no box around any caption.

## 2. Colour

| Token | Hex | Use |
| --- | --- | --- |
| ground | `#161616` | page background |
| frame ground | `#000000` | behind letterboxed artwork inside a frame |
| pending ground | `#1F1F1F` | frame with no selected artwork |
| ink | `#ECE8DF` | primary text, shot numerals, page number |
| secondary | `#A8A297` | camera note text, cover meta line |
| muted | `#8F8A80` | kickers, running header right side, footer, parentheticals |
| accent | `#C9A24A` | panel letters, rails, CAMERA label, character cues, cover kicker, contents numerals |
| rule | `#333029` | footer rule, cover contents rule |

Artwork is drawn as supplied (greyscale pencil boards look correct on charcoal).
Transparency in PNG sources flattens to the frame ground, not to paper white.
Composition markers and labelled arrows keep their current vector rendering
but use accent for camera and ink for action.

## 3. Type

Three families, all SIL OFL, bundled under `studio/lib/pdf/fonts/` with
provenance in that folder's README (download from the google/fonts GitHub
repository, record commit and SHA-256 as done for Courier Prime):

- Barlow Condensed: Light (300), Medium (500), SemiBold (600).
- Barlow: Regular (400), Medium (500).
- Courier Prime: Regular (existing).

Noto Sans is no longer used by the exporter and its files can be removed once
nothing else imports them.

The complete type scale. Nothing else is used.

| Role | Face | Size / leading | Colour | Notes |
| --- | --- | --- | --- | --- |
| Shot numeral | Barlow Condensed Light | 44 / 40 | ink | `2.01` (scene.shot, shot two digits) |
| Shot numeral, shared row | Barlow Condensed Light | 28 / 26 | ink | when two or three single-panel shots share a row |
| Kicker | Barlow Condensed Medium | 8 / 11, tracking 0.22 em, uppercase | muted unless stated | running header, shot meta, footer, continues lines, framing/angle, "ARTWORK PENDING" |
| Field label | Barlow Medium | 9.5 / 13.5, tracking 0.06 em, uppercase | accent for `CAMERA`, muted for `NOTE` | sits on the note's own baseline and size so it reads as part of the line |
| Panel letter | Barlow Condensed SemiBold | 16 / 15 | accent | `A` `B` … |
| Action | Barlow Regular | 10 / 14 | ink | the panel description |
| Camera note | Barlow Regular | 9.5 / 13.5 | secondary | after the `CAMERA` field label |
| Dialogue | Courier Prime | 9.5 / 13.5 | ink; cue in accent; parenthetical muted | |
| Rail label, type | Barlow Condensed Medium | 8 / 11, tracking 0.14 em, uppercase | accent | `DOLLY` |
| Rail label, description | Barlow Medium | 8.5 / 11 | ink | `Handheld, frantic, over shoulder` |
| Rail endpoint | Barlow Condensed Medium | 9 / 11 | ink | `A`, `B`, `(to B)`, `(from A)`, `2.02` |
| Cover kicker | Barlow Condensed Medium | 8 / 11, tracking 0.22 em | accent | `STORYBOARD · TEASER` |
| Cover title | Barlow Condensed Light | 66 / 60 | ink | wraps to the content width |
| Cover meta | Barlow Regular | 10.5 / 15 | secondary | |
| Cover contents number | Barlow Condensed Light | 18 / 18 | accent | |
| Cover contents title | Barlow Regular | 10 / 14 | ink | |

Text is never shrunk to fit. Long copy takes more vertical room (section 8).
Unsupported glyphs raise the existing actionable export error.

## 4. Page anatomy (board pages)

Top to bottom:

1. Running header, on the top margin line: project name at left (kicker, ink),
   `SCENE 2 · UNLUCKY QUOKKA` at right (kicker, muted; scene title omitted when
   it is the generic `Scene N`). Uses the scene of the first shot on the page.
2. Body: a sequence of blocks (section 5) flowing down.
3. Footer: rule (0.75 pt, rule colour) across the content width, 8 pt above
   the footer text. Left: kicker `DRAFT 3 · 14 SEP 2026 · 2.39 : 1` (draft
   label omitted when empty; date is the project's updated date, formatted
   `14 SEP 2026`). Right: kicker `PAGE 3 OF 11`, muted like the left side, counting every
   page including the cover.

No other running text. `STORYBOARD`, `FRAME /`, `N PANELS` on the right, and
the repeated project title stack are gone.

## 5. Blocks

Every board page is built from these blocks, in project order.

### 5.1 Scene band

Marks a scene change inside a page. Height 30 pt: a rule (0.75 pt, rule colour)
then the kicker `SCENE 3 · QUOKKA QUORPORATE` in ink. Not drawn when the scene
starts at the top of a page (the running header already says it). The first
scene of the document draws no band.

Scenes flow; a new scene does not force a new page. Export option
`sceneBreaks: 'flow' | 'page'` (default `flow`) lets a caller force page
breaks per scene.

### 5.2 Shot heading

Numeral `2.01` at the left, and, baseline-aligned 12 pt to its right, the meta
kicker: `2 PANELS · CONTINUOUS`. The meta says the panel count and one of
`CONTINUOUS` (any camera move connection inside the shot), `STATIC CAMERA`
(every adjacent panel pair has an explicitly recorded static connection and
the panel camera notes are empty), or nothing after the count. Missing
connection data never produces `STATIC CAMERA`; the exporter does not claim
what the director did not record. A custom shot title, when present and not the
automatic `Shot N`, follows on the same kicker line: `2 PANELS · THE BUS`.
Space above: 30 pt after a previous block; 0 at the top of a page. Space below:
10 pt.

When a shot continues on a later page its heading repeats there as `2.02` with
the meta `CONTINUED · E–G`.

### 5.3 Row

A row is: frames, then an optional rail, then captions. A row never splits
across pages.

Frames: `columns` frames of frame width, or one full-width frame. Frame
grounds are black; artwork is placed with the existing `getImagePlacement`
transform; frames with no artwork use the pending ground with the kicker
`ARTWORK PENDING` centred.

Row packing, per shot, in panel order:

- A panel with `pdfFullWidth === true` takes a row of its own at full width.
  This is the user's choice and the only way to get a large frame.
- Other panels fill rows of `columns` frames. A partial last row is left-aligned
  with empty space at the right.
- Consecutive shots whose panels are all single and not full-width may share a
  row (up to `columns` shots). Each column then carries its own small shot
  numeral (28 pt) and meta kicker above the frame, and the shot-heading block
  is not drawn separately. This is the only case where a shot heading is small.

Rail: see section 6. Drawn between frames and captions, 14 pt tall plus 4 pt
above and 3 pt below. Omitted when no connection touches this row; captions
then follow the frames after a 7 pt gap.

Captions: one caption block per frame in the same columns (section 7). Row
height = frames + rail + tallest caption.

Space between rows of the same shot: 16 pt.

### 5.4 Continues line

When a shot's rows are split across a page boundary, the last line on the
first page is a right-aligned kicker `2.02 CONTINUES → E–G` placed 12 pt below
the last row. It is only drawn if it fits; otherwise it is omitted (the next
page's heading says `CONTINUED` regardless).

## 6. Rails: camera moves and shot transitions

A rail is a horizontal line in accent, 0.6 pt, drawn in the rail band beneath
a row of frames, with these marks:

- Source mark: a filled circle, radius 1.9 pt, at the source frame's horizontal
  centre.
- Destination mark: a filled triangle arrowhead 6 pt long, 6 pt wide, whose
  tip is at the destination frame's horizontal centre.
- Endpoint text: the source panel letter, right-aligned 5 pt left of the
  source mark; the destination letter, left-aligned 5 pt right of the
  arrowhead tip. Both in the rail endpoint style.
- Label: the move type in rail-label-type style, two spaces, the description
  in rail-label-description style, centred on the segment between source and
  destination marks, knocked out over the line with a ground-coloured
  rectangle padded 7 pt each side. If the label is wider than the segment less
  the marks and endpoint text, the description wraps to a second line beneath
  the first (the band grows by one line, 11 pt); the type stays on the first
  line. Descriptions never truncate.

Which connections draw:

- Panel connections inside a shot (`shot.panelConnections`, type from
  `PANEL_CONNECTION_TYPES`) whose type is not `static`, or whose description
  is non-empty. A `static` with a description draws with the label `STATIC`.
- Shot connections (`scene.shotConnections`) between the last panel of one
  shot and the first of the next, when the transition is not a plain
  descriptionless `cut`, or a movement is set. The label joins the parts with
  ` · `: `DISSOLVE  Cross-fade on the cloud · DOLLY  Slow push`. Endpoint text
  uses shot codes rather than letters: `2.01` and `2.02`. Plain cuts draw
  nothing.

Placement cases, by where the two frames sit:

1. **Same row.** `A •————— label —————▶ B`. Source mark at A's centre,
   arrowhead at B's centre.
2. **Different rows (next row, next page, or later).** The rail wraps like a
   line of text and the label is written once, at the source:
   - Source row: `A •————— label —————▶ (to B)`. The line runs from A's centre
     to the content's right edge. The arrowhead tip sits at the right edge and
     the endpoint text `(to B)` is knocked out on the line immediately left of
     the arrowhead. The label is centred on the segment between the source
     mark and `(to B)`.
   - Destination row: `(from A) —————▶ B`. The line starts at the content's
     left edge with the endpoint text `(from A)` knocked out on it, and runs to
     the arrowhead at B's centre, followed by `B`. No label.
   - If the destination row is the first row on a page, the incoming half
     is still drawn there.
3. **Chains.** A→B→C in one row draws two segments on one line: `A •—— label
   ——▶ B •—— label ——▶ C`. The B mark is an arrowhead followed by a circle 4 pt
   to its right. Chains across rows combine cases 1 and 2.
4. **Full-width source or destination.** The frame centre is the content
   centre; nothing else changes.

Rails replace every existing cue: gutter arrows, dotted cross-row cues,
transition bands and boxed transition labels are all removed.

## 7. Caption block

Below each frame, in its column. Layout: the panel letter in a 20 pt column at
the left, and a text column filling the rest, 8 pt gap. Vertical items in the
text column, 5 pt apart, each omitted when empty:

1. Framing and angle kicker, muted: `MCU · LOW ANGLE` (framing, then angle,
   joined with ` · `). Custom panel titles that are not automatic `Panel N`
   are appended: `MCU · LOW ANGLE · THE STARE`.
2. Action: the panel description, Action style. Line breaks in the source are
   kept.
3. Camera: the `CAMERA` field label in accent, then a 6 pt gap, then the
   camera text in Camera note style on the same baseline; wrapped lines align
   with the text start.
4. Dialogue: Dialogue style, no indent, no heading. Parsed with the grammar
   below.
5. Notes (only with `includeNotes`): the `NOTE` field label in muted then the
   note text in Camera note style, same arrangement as Camera.

A panel with no text prints the letter alone.

### Dialogue grammar

The dialogue field is free text in screenplay convention. Split into lines and
classify each:

- **Character cue**: a line whose letters are all uppercase (digits,
  punctuation, spaces and a trailing parenthetical extension such as `(V.O.)`,
  `(O.S.)`, `(CONT'D)` allowed), that contains at least one letter, and that
  is immediately followed by a non-blank line. Printed in accent.
- **Parenthetical**: a line that starts with `(` and ends with `)` and is not a
  cue. Printed muted.
- **Spoken line**: anything else. Printed in ink.
- A blank line is a 6 pt gap.

The editor's dialogue field shows the hint: "Character name on its own line
in CAPITALS, dialogue on the lines beneath. `(V.O.)` and `(beat)` are fine."

## 8. Pagination

- Blocks are placed top-down. The body runs from the top margin (below the
  running header, 22 pt clearance) to the footer rule (10 pt clearance).
- A shot heading is never left alone at the bottom of a page: heading + its
  first row must fit, else both move to the next page.
- A row never splits. If a single row is taller than a whole page body (a very
  long caption), the frames, rail and captions print, and the overflow text of
  the tallest captions continues on the next page under the kicker
  `2.02 A · CONTINUED` in the same column widths. This is the only case where
  text leaves its row.
- A rail's destination half prints wherever the destination row lands.
- No page is left with more than one row of unused space when the next row
  would fit; the only vertical slack on a page is the remainder below the last
  row that fits.
- Empty shots (no panels) print the heading and one pending frame.
- Scenes with no shots print the scene band and the kicker `NO SHOTS`.

## 9. Cover page

Included by default; export option `includeCover: false` removes it. The cover
is page 1 and shows no page number.

- Top 43% of the page height: the cover image, drawn full bleed with `cover`
  fit (centred crop). The cover image is the project's `coverImage` when the
  user has chosen one, otherwise the first selected artwork in project order.
  Neither present: pending ground.
- Below, inside the side margins, 40 pt from the image:
  - Cover kicker: `STORYBOARD · TEASER` (project `subtitle`, uppercase;
    `STORYBOARD` alone when empty).
  - Cover title: project name, 10 pt below the kicker.
  - Cover meta, 14 pt below: `Draft 3 · 14 September 2026 · 2.39 : 1 · Rough
    blocking sketch` (draft label, updated date in long form, ratio, style;
    empty parts omitted).
  - Contents, 40 pt below, above a rule: scenes in two columns (three in
    landscape), each `1  Rottnest  2 SHOTS · 02`: contents number in accent,
    scene title (or `Scene 1`), kicker with shot count and the page where the
    scene starts.
  - Footer line at the bottom margin: left kicker `16 SHOTS · 31 PANELS`;
    right kicker `DIRECTOR · PRODUCTION · CONTACT` from the project fields,
    empties omitted, uppercase.

## 10. Data and editor changes

`StoryProject` gains optional strings: `subtitle`, `draftLabel`, `director`,
`production`, `contact`. Project settings gets a "Cover" group with those five
fields. All default empty; the cover omits empty parts.

`StoryProject` also gains an optional `coverImage` of `{ dataUrl, mimeType,
label }`. The Cover group lets the user pick any image file from their computer
(PNG, JPEG, WebP, GIF or AVIF, the same set and the same 20 MB limit as
reference uploads), shows a thumbnail with the file name, and removes it again.
The field is absent by default, and the cover then falls back to the first
selected artwork.

`Panel.action` is removed. Migration on load: when a legacy `action` is
non-empty and the description does not already contain it, append it to
`description` after a line break. Generation prompts stop reading `action`.

`Panel.transitionNote` is removed. Migration on load: the existing conversion
into `panelConnections` / `shotConnections` descriptions runs, then the field
is dropped.

`Panel.pdfFullWidth` stays. Editor label stays "Full-width in PDF". Default is
off; two per row is the standard.

Shot-level `description`, `dialogue`, `camera`, `action`, `notes` remain in the
type only as legacy fallbacks read by `getPanelDetails`; the editor does not
expose them.

`createStoryboardPdf(project, options)` options: `layout`, `sceneId`,
`includeNotes` (existing) plus `includeCover` (default true) and `sceneBreaks`
(default `flow`). `sceneId` exports still include the cover, whose contents list
only the selected scene.

## 11. Removed from the current export

Paper tint, frame borders, `STORYBOARD` kicker, the `Scene 01, Shot 01` spelled
headings, the `S01-01A` codes, `N PANELS` on the right, `FRAME / 2.39:1`,
`Page X of Y`, gutter arrows, dotted cross-row cues, `FROM … -> …` labels,
transition boxes and bands, the per-field `CAMERA` / `DIALOGUE` / `ACTION`
uppercase labels, and every type size not in section 3.

## 12. Acceptance

Render the Quokka project (`/Users/rocklobster/Desktop/Quokka Storyboards/Quokka
Storyboards`) in all three layouts and compare against the canvas mockups.
Check: no page more than one row short when a following row would fit, every
camera move drawn once with the correct endpoint text, dialogue cues in accent,
the cover contents page numbers correct, fonts embedded (`pdffonts`), and the
file size no larger than the current export for the same project.
