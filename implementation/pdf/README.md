# Storyboard PDF export

`createStoryboardPdf(project, options?)` returns A4 portrait PDF bytes and is safe
to call in the browser. The caller owns previewing or downloading those bytes.

The exporter uses `pdf-lib`, `@pdf-lib/fontkit`, and locally bundled Noto Sans
under the included SIL Open Font License, so it has no OS font or server dependency. It preserves the configured canvas ratio, embeds only
the selected panel image version, uses an intentional empty-art frame when a panel
has no selection, and draws composition markers plus labelled action/camera arrows
as PDF vectors.

Long captions and shot-level fields are flowed across continuation pages. Dialogue
is emitted once, after the final panel in its shot. Unsupported glyphs outside
Noto Sans coverage produce an actionable export error
instead of silently changing the written material. Browser-native WebP, GIF, and AVIF uploads are converted to PNG
in memory before embedding; PNG and JPEG are embedded directly.

Integration dependency:

```sh
npm install pdf-lib @pdf-lib/fontkit
```

The draft import `../storyboard/model` is the final integrated path described in
`BUILD-CONTRACT.md`; it is intentionally unresolved inside `implementation/`.
