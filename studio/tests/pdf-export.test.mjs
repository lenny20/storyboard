import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { createStoryboardPdf } from '../lib/pdf/export.ts';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url =
    input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'file:') {
    return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  }
  return nativeFetch(input, init);
};

/** Section 2 colour tokens, as pdf.js reports fills. */
const INK = '#ece8df';
const SECONDARY = '#a8a297';
const MUTED = '#8f8a80';
const ACCENT = '#c9a24a';

// ---------------------------------------------------------------- inspection

/**
 * Every drawn string with the fill colour, font size and position pdf.js
 * resolves for it. The operator list is used rather than `getTextContent`
 * because letter-spaced kickers come back intact and carry their colour.
 */
async function inspect(bytes) {
  const document = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages = [];
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const list = await page.getOperatorList();
      const viewport = page.getViewport({ scale: 1 });
      const items = [];
      let fill = null;
      let size = 0;
      let matrix = [1, 0, 0, 1, 0, 0];
      for (let index = 0; index < list.fnArray.length; index += 1) {
        const operator = list.fnArray[index];
        const args = list.argsArray[index];
        if (operator === OPS.setFillRGBColor) fill = args[0];
        else if (operator === OPS.setFont) size = args[1];
        // pdf.js hands the text matrix over as one indexed object.
        else if (operator === OPS.setTextMatrix) matrix = args[0];
        else if (operator === OPS.showText) {
          const text = args[0]
            .map((glyph) =>
              glyph && typeof glyph === 'object' ? (glyph.unicode ?? '') : '',
            )
            .join('');
          if (text.trim())
            items.push({
              text,
              color: fill,
              size: Math.round(size * 100) / 100,
              x: matrix[4],
              y: matrix[5],
            });
        }
      }
      pages.push({ number, items, width: viewport.width, height: viewport.height });
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

function textOf(page) {
  return page.items.map((item) => item.text).join(' ');
}

function allItems(pages) {
  return pages.flatMap((page) =>
    page.items.map((item) => ({ ...item, page: page.number })),
  );
}

function find(pages, text) {
  return allItems(pages).filter((item) => item.text === text);
}

/** Sizes that tell the spec's roles apart when they share a string. */
const RAIL_ENDPOINT = 9;
const PANEL_LETTER = 16;

function findSized(pages, text, size) {
  return allItems(pages).filter(
    (item) => item.text === text && item.size === size,
  );
}

function onlySized(pages, text, size) {
  const found = findSized(pages, text, size);
  assert.equal(
    found.length,
    1,
    `expected exactly one "${text}" at ${size} pt, got ${found.length}`,
  );
  return found[0];
}

function only(pages, text) {
  const found = find(pages, text);
  assert.equal(found.length, 1, `expected exactly one "${text}", got ${found.length}`);
  return found[0];
}

async function baseFontNames(bytes) {
  const document = await PDFDocument.load(bytes);
  const names = new Set();
  for (const page of document.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    if (!fonts) continue;
    for (const [, reference] of fonts.entries()) {
      const dictionary = document.context.lookup(reference, PDFDict);
      const baseFont = dictionary.get(PDFName.of('BaseFont'));
      if (baseFont instanceof PDFName) names.add(baseFont.decodeText());
    }
  }
  return [...names];
}

// ------------------------------------------------------------------ fixtures

function panel(id, extra = {}) {
  return {
    id,
    title: '',
    framing: '',
    angle: '',
    description: '',
    versions: [],
    selectedVersionId: null,
    markers: [],
    arrows: [],
    ...extra,
  };
}

function shot(id, panels, extra = {}) {
  return {
    id,
    title: '',
    description: '',
    dialogue: '',
    action: '',
    camera: '',
    notes: '',
    referenceIds: [],
    panels,
    panelConnections: [],
    ...extra,
  };
}

function scene(id, shots, extra = {}) {
  return { id, title: '', shots, shotConnections: [], ...extra };
}

function project(scenes, extra = {}) {
  return {
    schemaVersion: 1,
    id: 'project',
    name: 'Quokka Storyboards',
    aspectRatio: 2.39,
    style: 'Rough blocking sketch',
    styleNotes: '',
    scenes,
    references: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    ...extra,
  };
}

/** One shot of `count` panels, with a connection of `type` between each pair. */
function chainShot(id, count, type = 'static', description = '') {
  const panels = Array.from({ length: count }, (_, index) =>
    panel(`${id}-${index}`, { description: `Beat ${index + 1}` }),
  );
  return shot(id, panels, {
    panelConnections: panels.slice(0, -1).map((entry, index) => ({
      fromId: entry.id,
      toId: panels[index + 1].id,
      type,
      description,
    })),
  });
}

const BOARD = { includeCover: false };

// --------------------------------------------------------------------- fonts

test('embeds the three spec families and drops Noto Sans', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [
        shot(
          'a',
          [
            panel('a-0', { description: 'She waits.', dialogue: 'HE\nspeaks.' }),
            panel('a-1'),
          ],
          {
            panelConnections: [
              { fromId: 'a-0', toId: 'a-1', type: 'dolly', description: 'Push' },
            ],
          },
        ),
      ]),
    ]),
    BOARD,
  );
  const names = await baseFontNames(bytes);
  for (const face of [
    'BarlowCondensed-Light',
    'BarlowCondensed-Medium',
    'BarlowCondensed-SemiBold',
    'Barlow-Regular',
    'Barlow-Medium',
    'CourierPrime-Regular',
  ]) {
    assert.ok(
      names.some((name) => name.includes(face)),
      `${face} should be embedded; found ${names.join(', ')}`,
    );
  }
  assert.ok(
    !names.some((name) => /NotoSans/i.test(name)),
    `Noto Sans is no longer used by the exporter: ${names.join(', ')}`,
  );
});

test('rejects a character no bundled font can draw', async () => {
  const broken = project([
    scene('s', [shot('a', [panel('p', { description: 'A quokka \u{1F600}' })])]),
  ]);
  await assert.rejects(
    createStoryboardPdf(broken),
    /cannot render character "\u{1F600}"/u,
  );
});

// ------------------------------------------------------------- page anatomy

test('runs a header and a footer, and counts the cover in the page number', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s1', [chainShot('a', 2)], { title: 'Rottnest' }),
      scene('s2', [chainShot('b', 2)], { title: 'Scene 2' }),
    ]),
  );
  const pages = await inspect(bytes);
  const board = pages[1];
  assert.equal(
    board.items.find((item) => item.text === 'QUOKKA STORYBOARDS')?.color,
    INK,
  );
  assert.ok(find(pages, 'SCENE 1 · ROTTNEST').length > 0);
  // The generic title `Scene 2` is dropped from the running header.
  assert.ok(find(pages, 'SCENE 2').length > 0);
  assert.equal(find(pages, 'SCENE 2 · SCENE 2').length, 0);
  assert.equal(
    board.items.find((item) => item.text === '14 SEP 2026 · 2.39 : 1')
      ?.color,
    MUTED,
  );
  const numbers = allItems(pages).filter((item) => /^\d\d \/ \d\d$/.test(item.text));
  assert.deepEqual(
    numbers.map((item) => item.text),
    Array.from({ length: pages.length - 1 }, (_, index) =>
      `${String(index + 2).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}`,
    ),
  );
  assert.ok(
    numbers.every((item) => item.page > 1),
    'the cover shows no page number',
  );
});

test('numbers a longer document 03 / N on its third page', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene(
        's',
        Array.from({ length: 6 }, (_, index) => chainShot(`sh${index}`, 4)),
      ),
    ]),
  );
  const pages = await inspect(bytes);
  assert.ok(pages.length >= 4);
  const total = String(pages.length).padStart(2, '0');
  assert.equal(find(pages, `03 / ${total}`).length, 1);
  assert.equal(find(pages, `03 / ${total}`)[0].page, 3);
});

test('prints the draft label when the project carries one', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 1)])], { draftLabel: 'Draft 3' }),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(find(pages, 'DRAFT 3 · 14 SEP 2026 · 2.39 : 1').length, 1);
});

// --------------------------------------------------------------------- cover

test('builds the cover from the project fields and the scene start pages', async () => {
  const bytes = await createStoryboardPdf(
    project(
      [
        scene('s1', [chainShot('a', 2)], { title: 'Rottnest' }),
        scene('s2', [chainShot('b', 2)], { title: 'Quokka Quorporate' }),
      ],
      {
        subtitle: 'Teaser',
        draftLabel: 'Draft 3',
        director: 'A Director',
        production: 'A Production',
        contact: 'hello@example.com',
      },
    ),
  );
  const pages = await inspect(bytes);
  const cover = pages[0];
  const text = textOf(cover);
  assert.match(text, /STORYBOARD · TEASER/);
  assert.match(text, /Quokka Storyboards/);
  assert.match(
    text,
    /Draft 3 · 14 September 2026 · 2\.39 : 1 · Rough blocking sketch/,
  );
  assert.match(text, /Rottnest/);
  assert.match(text, /Quokka Quorporate/);
  assert.match(text, /2 SHOTS · 4 PANELS/);
  assert.match(text, /A DIRECTOR · A PRODUCTION · HELLO@EXAMPLE\.COM/);
  assert.equal(
    cover.items.find((item) => item.text === 'STORYBOARD · TEASER')?.color,
    ACCENT,
  );
  // The contents numerals are accent, and each scene names the page it opens.
  assert.equal(cover.items.find((item) => item.text === '1')?.color, ACCENT);
  const startPages = new Map();
  for (const page of pages.slice(1)) {
    const label = page.items.find((item) => /^SCENE \d/.test(item.text));
    if (label && !startPages.has(label.text))
      startPages.set(label.text, page.number);
  }
  for (const [label, number] of startPages) {
    const padded = String(number).padStart(2, '0');
    assert.ok(
      cover.items.some((item) => item.text.endsWith(`· ${padded}`)),
      `${label} starts on page ${padded}, which the contents should show`,
    );
  }
});

test('includeCover: false removes the cover and renumbers from one', async () => {
  const scenes = [scene('s', [chainShot('a', 2)])];
  const withCover = await inspect(await createStoryboardPdf(project(scenes)));
  const without = await inspect(
    await createStoryboardPdf(project(scenes), BOARD),
  );
  assert.equal(without.length, withCover.length - 1);
  assert.equal(
    find(without, 'STORYBOARD').length,
    0,
    'the cover kicker is gone with the cover',
  );
  assert.equal(find(withCover, 'STORYBOARD').length, 1);
  assert.equal(find(without, '01 / 01').length, 1);
});

// ------------------------------------------------------------- shot headings

test('heads a shot with its code and meta kicker', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s1', [chainShot('a', 1)]),
      scene('s2', [
        chainShot('b', 2, 'dolly', 'Slow push'),
        shot('c', [panel('c-0'), panel('c-1')], {
          title: 'The Bus',
          panelConnections: [
            { fromId: 'c-0', toId: 'c-1', type: 'static', description: '' },
          ],
        }),
      ]),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(find(pages, '1.01').length, 1);
  // A single panel has no recorded connection, so the camera is not described.
  assert.equal(only(pages, '1 PANEL').color, MUTED);
  assert.equal(find(pages, '1 PANEL · STATIC CAMERA').length, 0);
  assert.equal(find(pages, '2.01').length, 1);
  assert.equal(find(pages, '2 PANELS · CONTINUOUS').length, 1);
  assert.equal(find(pages, '2 PANELS · STATIC CAMERA · THE BUS').length, 1);
  assert.equal(only(pages, '1.01').size, 44);
});

test('drops the motion word when a static shot still has camera notes', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [
        shot('a', [panel('a-0', { camera: 'Locked off' }), panel('a-1')], {
          panelConnections: [
            { fromId: 'a-0', toId: 'a-1', type: 'static', description: '' },
          ],
        }),
      ]),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(find(pages, '2 PANELS').length, 1);
  assert.equal(find(pages, '2 PANELS · STATIC CAMERA').length, 0);
});

test('never claims a static camera when no connection was recorded', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [shot('a', [panel('a-0'), panel('a-1')])])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(find(pages, '2 PANELS').length, 1);
  assert.equal(find(pages, '2 PANELS · STATIC CAMERA').length, 0);
});

test('shares one row between single-panel shots, each with a small numeral', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 1), chainShot('b', 1)])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  const first = only(pages, '1.01');
  const second = only(pages, '1.02');
  assert.equal(first.size, 28, 'a shared row uses the small shot numeral');
  assert.equal(second.size, 28);
  assert.equal(
    Math.round(first.y),
    Math.round(second.y),
    'both numerals sit on one baseline above their own column',
  );
  assert.ok(second.x > first.x + 200, 'the second shot takes the next column');
});

test('keeps a full-width panel in a row of its own across the content width', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [
        shot('a', [panel('a-0', { pdfFullWidth: true }), panel('a-1')], {
          panelConnections: [
            { fromId: 'a-0', toId: 'a-1', type: 'dolly', description: 'Push' },
          ],
        }),
      ]),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  // A's frame is the content width, so its rail source mark is the page centre.
  const source = onlySized(pages, 'A', RAIL_ENDPOINT);
  assert.ok(
    Math.abs(source.x - 297.64) < 24,
    `the full-width source mark sits at the content centre, got ${source.x}`,
  );
  const outgoing = onlySized(pages, '(to B)', RAIL_ENDPOINT);
  assert.ok(outgoing.x > 460, 'the wrapped half reaches the content right edge');
  const incoming = onlySized(pages, '(from A)', RAIL_ENDPOINT);
  assert.ok(incoming.x < 40, 'the incoming half starts at the content left edge');
  const letters = findSized(pages, 'A', PANEL_LETTER).concat(
    findSized(pages, 'B', PANEL_LETTER),
  );
  assert.equal(letters.length, 2);
  assert.ok(
    letters.every((item) => item.x < 40),
    'a full-width row and a lone partial row both start at the left margin',
  );
});

// ---------------------------------------------------------------------- rails

test('draws a same-row camera move as one labelled rail between the frames', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 2, 'dolly', 'Slow push')])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  const from = onlySized(pages, 'A', RAIL_ENDPOINT);
  const to = onlySized(pages, 'B', RAIL_ENDPOINT);
  const type = only(pages, 'DOLLY');
  assert.equal(type.color, ACCENT);
  assert.equal(from.color, INK);
  const words = find(pages, 'Slow').concat(find(pages, 'push'));
  assert.equal(words.length, 2);
  assert.ok(
    Math.abs(from.y - to.y) < 1,
    'both endpoints sit on one rail line',
  );
  assert.ok(
    from.x < type.x && type.x < to.x,
    'the label is centred on the segment between the marks',
  );
  assert.ok(
    words.every((word) => Math.abs(word.y - type.y) < 1),
    'type and description share the label line',
  );
});

test('wraps a cross-row move into (to B) on the source row and (from A) on the destination', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 3, 'pan', 'Follow her')])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  const outgoing = only(pages, '(to C)');
  const incoming = only(pages, '(from B)');
  assert.ok(outgoing.y > incoming.y, 'the source half sits on the earlier row');
  assert.ok(outgoing.x > 480, '(to C) is knocked out before the right edge');
  assert.ok(incoming.x < 40, '(from B) starts at the content left edge');
  // The label is written once, at the source.
  assert.equal(find(pages, 'PAN').length, 2, 'A to B and B to C each carry one');
  assert.equal(find(pages, 'Follow').length, 2);
});

test('carries a wrapped rail across a page break', async () => {
  const long =
    'A very long panel description that takes several lines of the caption column and therefore pushes the next row onto a page of its own. '.repeat(
      12,
    );
  const shotRef = chainShot('a', 3, 'dolly', 'Push through');
  shotRef.panels[1].description = long;
  const bytes = await createStoryboardPdf(project([scene('s', [shotRef])]), BOARD);
  const pages = await inspect(bytes);
  const outgoing = only(pages, '(to C)');
  const incoming = only(pages, '(from B)');
  assert.equal(
    incoming.page,
    outgoing.page + 1,
    'the incoming half is drawn on the destination row wherever it lands',
  );
  assert.equal(
    find(pages, 'C').filter((item) => item.page === incoming.page).length >= 1,
    true,
  );
});

test('draws a chain as one rail with an arrowhead and a source mark at each junction', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 3, 'zoom', 'Tighten')])]),
    { ...BOARD, layout: 'landscape-3up' },
  );
  const pages = await inspect(bytes);
  const endpoints = allItems(pages).filter(
    (item) => item.size === 9 && /^[ABC]$/.test(item.text),
  );
  const rail = endpoints.filter((item) => item.text !== 'B');
  assert.equal(rail.length, 2, 'only the outer endpoints are named');
  assert.equal(
    endpoints.some((item) => item.text === 'B'),
    false,
    'the junction mark stands in for the middle letter',
  );
  const labels = find(pages, 'ZOOM');
  assert.equal(labels.length, 2, 'both segments are labelled');
  assert.ok(
    Math.abs(labels[0].y - labels[1].y) < 1,
    'a chain shares one rail line',
  );
});

test('labels a shot transition with shot codes and joins transition to movement', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene(
        's',
        [chainShot('a', 1), chainShot('b', 1)],
        {
          shotConnections: [
            {
              fromId: 'a',
              toId: 'b',
              type: 'dissolve',
              description: 'Cross-fade on the cloud',
              movement: 'dolly',
              movementDescription: 'Slow push',
            },
          ],
        },
      ),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  const from = onlySized(pages, '1.01', RAIL_ENDPOINT);
  const to = onlySized(pages, '1.02', RAIL_ENDPOINT);
  assert.ok(
    Math.abs(from.y - to.y) < 1,
    'the transition rail names both shots by code on one line',
  );
  assert.ok(from.x < to.x);
  assert.equal(only(pages, 'DISSOLVE').color, ACCENT);
  assert.equal(only(pages, 'DOLLY').color, ACCENT);
  assert.equal(only(pages, '·').color, INK);
  for (const word of ['Cross-fade', 'on', 'the', 'cloud', 'Slow', 'push'])
    assert.equal(find(pages, word).length, 1, `the label keeps "${word}"`);
});

test('draws nothing for a plain descriptionless cut', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [chainShot('a', 1), chainShot('b', 1)], {
        shotConnections: [
          {
            fromId: 'a',
            toId: 'b',
            type: 'cut',
            description: '',
            movement: 'static',
            movementDescription: '',
          },
        ],
      }),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(find(pages, 'CUT').length, 0);
  const codes = allItems(pages).filter((item) => item.text === '1.01');
  assert.ok(
    codes.every((item) => item.size === 28),
    'the only 1.01 on the page is the shared-row heading, not a rail endpoint',
  );
});

test('draws a static connection that carries a description, labelled STATIC', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 2, 'static', 'Hold the frame')])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(only(pages, 'STATIC').color, ACCENT);
  assert.equal(find(pages, 'Hold').length, 1);
});

test('wraps a long rail description instead of truncating it', async () => {
  const description =
    'Handheld and frantic over the shoulder as she runs the length of the platform and the bus pulls away without her';
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 2, 'dolly', description)])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  for (const word of description.split(' '))
    assert.ok(find(pages, word).length >= 1, `the rail keeps "${word}"`);
  const lines = new Set(
    description
      .split(' ')
      .flatMap((word) => find(pages, word))
      .map((item) => Math.round(item.y)),
  );
  assert.ok(lines.size > 1, 'the description wraps onto a second rail line');
});

// ------------------------------------------------------------------ captions

test('classifies dialogue into cues, parentheticals and spoken lines', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [
        shot('a', [
          panel('p', {
            dialogue:
              "MATILDA (V.O.)\n(beat)\nJust a few miles off the coast.\n\nDEREK\nCONT'D and shouting.",
          }),
        ]),
      ]),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(only(pages, 'MATILDA (V.O.)').color, ACCENT);
  assert.equal(only(pages, '(beat)').color, MUTED);
  assert.equal(only(pages, 'Just a few miles off the coast.').color, INK);
  assert.equal(only(pages, 'DEREK').color, ACCENT);
  assert.equal(only(pages, "CONT'D and shouting.").color, INK);
});

test('treats a trailing uppercase line with nothing beneath it as spoken', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [
        shot('a', [panel('p', { dialogue: 'She turns.\nSTOP RIGHT THERE' })]),
      ]),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(
    only(pages, 'STOP RIGHT THERE').color,
    INK,
    'a cue must be followed by a line, so this is spoken',
  );
});

test('lays out the caption items the spec lists, in order', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s', [
        shot('a', [
          panel('p', {
            framing: 'MCU',
            angle: 'Low angle',
            title: 'The Stare',
            description: 'He does not blink.',
            camera: 'Locked off, centre frame.',
            dialogue: 'He waits.',
            notes: 'Check the eyeline.',
          }),
        ]),
      ]),
    ]),
    { ...BOARD, includeNotes: true },
  );
  const pages = await inspect(bytes);
  const letter = only(pages, 'A');
  const meta = only(pages, 'MCU · LOW ANGLE · THE STARE');
  const action = only(pages, 'He does not blink.');
  const cam = only(pages, 'CAM');
  const camera = only(pages, 'Locked off, centre frame.');
  const dialogue = only(pages, 'He waits.');
  const note = only(pages, 'NOTE');
  assert.equal(letter.color, ACCENT);
  assert.equal(meta.color, MUTED);
  assert.equal(action.color, INK);
  assert.equal(cam.color, ACCENT);
  assert.equal(camera.color, SECONDARY);
  assert.equal(dialogue.color, INK);
  assert.equal(note.color, MUTED);
  assert.ok(
    meta.y > action.y && action.y > camera.y && camera.y > dialogue.y &&
      dialogue.y > only(pages, 'Check the eyeline.').y,
    'the caption runs framing, action, camera, dialogue, notes',
  );
  assert.ok(letter.x < meta.x, 'the letter sits in its own column at the left');
  assert.ok(camera.x > cam.x, 'the camera text follows its kicker');
});

test('omits production notes unless includeNotes is set', async () => {
  const scenes = () => [
    scene('s', [shot('a', [panel('p', { notes: 'Internal note' })])]),
  ];
  const quiet = await inspect(
    await createStoryboardPdf(project(scenes()), BOARD),
  );
  assert.equal(find(quiet, 'NOTE').length, 0);
  assert.equal(find(quiet, 'Internal note').length, 0);
  const loud = await inspect(
    await createStoryboardPdf(project(scenes()), {
      ...BOARD,
      includeNotes: true,
    }),
  );
  assert.equal(find(loud, 'NOTE').length, 1);
  assert.equal(find(loud, 'Internal note').length, 1);
});

test('prints the letter alone for a panel with no text', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [shot('a', [panel('p')])])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.equal(only(pages, 'A').color, ACCENT);
});

// ---------------------------------------------------------------- pagination

test('fills a page with every row that fits', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 12)])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  const first = pages[0];
  const letters = first.items
    .filter((item) => item.size === 16 && /^[A-Z]$/.test(item.text))
    .map((item) => item.text);
  assert.ok(
    letters.length >= 8,
    `portrait fits four rows of two or more, got ${letters.join('')}`,
  );
  const rows = new Set(
    first.items
      .filter((item) => item.size === 16)
      .map((item) => Math.round(item.y)),
  );
  assert.ok(rows.size >= 4, `expected at least four rows, got ${rows.size}`);
});

test('never leaves a shot heading alone at the foot of a page', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene(
        's',
        Array.from({ length: 12 }, (_, index) => chainShot(`sh${index}`, 3)),
      ),
    ]),
    BOARD,
  );
  const pages = await inspect(bytes);
  for (const page of pages) {
    const headings = page.items.filter(
      (item) => item.size === 44 && /^\d+\.\d\d$/.test(item.text),
    );
    if (headings.length === 0) continue;
    const letters = page.items.filter(
      (item) => item.size === 16 && /^[A-Z]$/.test(item.text),
    );
    assert.ok(
      letters.length > 0,
      `page ${page.number} has a heading with no row beneath it`,
    );
    const lowest = Math.min(...headings.map((item) => item.y));
    assert.ok(
      Math.min(...letters.map((item) => item.y)) < lowest,
      `page ${page.number} ends with an orphaned heading`,
    );
  }
});

test('repeats a carried shot as CONTINUED and kicks the first page', async () => {
  // Two landscape rows fill page one and leave room for the kicker beneath.
  const bytes = await createStoryboardPdf(
    project([scene('s', [chainShot('a', 6)])]),
    { ...BOARD, layout: 'landscape-2up' },
  );
  const pages = await inspect(bytes);
  assert.equal(pages.length, 2);
  const continued = allItems(pages).filter((item) =>
    item.text.startsWith('CONTINUED · '),
  );
  assert.equal(continued.length, 1);
  assert.equal(continued[0].page, 2);
  assert.equal(continued[0].text, 'CONTINUED · E–F');
  const kicker = find(pages, '1.01 CONTINUES');
  assert.equal(kicker.length, 1, 'the first page ends with a continues kicker');
  assert.equal(kicker[0].page, 1);
  const range = find(pages, 'E–F').filter((item) => item.page === 1);
  assert.equal(range.length, 1);
  assert.ok(range[0].x > kicker[0].x, 'the range follows the vector arrow');
});

test('overflows the caption of a row taller than a page onto the next', async () => {
  const long = Array.from(
    { length: 120 },
    (_, index) => `Sentence number ${index} of a caption that will not fit.`,
  ).join(' ');
  const bytes = await createStoryboardPdf(
    project([scene('s', [shot('a', [panel('p', { description: long })])])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  assert.ok(pages.length > 1, 'the caption needs a second page');
  const marker = allItems(pages).filter((item) =>
    /^1\.01 A · CONTINUED$/.test(item.text),
  );
  assert.equal(marker.length, 1);
  assert.equal(marker[0].page, 2);
  assert.ok(
    textOf(pages[1]).includes('Sentence number 119'),
    'the tail of the caption survives',
  );
});

// ------------------------------------------------------------------- options

test('sceneBreaks: page starts every scene on a new page', async () => {
  const scenes = [
    scene('s1', [chainShot('a', 1)]),
    scene('s2', [chainShot('b', 1)]),
    scene('s3', [chainShot('c', 1)]),
  ];
  const flowed = await inspect(
    await createStoryboardPdf(project(scenes), BOARD),
  );
  assert.equal(flowed.length, 1, 'three small scenes flow onto one page');
  const broken = await inspect(
    await createStoryboardPdf(project(scenes), {
      ...BOARD,
      sceneBreaks: 'page',
    }),
  );
  assert.equal(broken.length, 3);
  assert.match(textOf(broken[0]), /SCENE 1/);
  assert.match(textOf(broken[1]), /SCENE 2/);
  assert.match(textOf(broken[2]), /SCENE 3/);
});

test('sceneId exports one scene and keeps a cover listing only that scene', async () => {
  const bytes = await createStoryboardPdf(
    project([
      scene('s1', [chainShot('a', 1)], { title: 'Rottnest' }),
      scene('s2', [chainShot('b', 1)], { title: 'Quorporate' }),
    ]),
    { sceneId: 's2' },
  );
  const pages = await inspect(bytes);
  const text = pages.map(textOf).join(' ');
  assert.match(text, /Quorporate/);
  assert.equal(/Rottnest/.test(text), false);
  assert.match(textOf(pages[0]), /1 SHOT · 1 PANEL/);
  assert.equal(find(pages, '2.01').length > 0, true, 'codes keep the scene number');
});

test('rejects a scene id that is not in the project', async () => {
  await assert.rejects(
    createStoryboardPdf(project([scene('s', [chainShot('a', 1)])]), {
      sceneId: 'missing',
    }),
    /scene "missing" was not found/,
  );
});

test('prints a scene with no shots and a shot with no panels', async () => {
  const bytes = await createStoryboardPdf(
    project([scene('s1', [shot('a', [])]), scene('s2', [])]),
    BOARD,
  );
  const pages = await inspect(bytes);
  const text = pages.map(textOf).join(' ');
  assert.match(text, /NO SHOTS/);
  assert.match(text, /ARTWORK PENDING/);
  assert.match(text, /1\.01/);
});

test('reports malformed project data instead of producing a broken file', async () => {
  await assert.rejects(createStoryboardPdf(null), /project data is missing/);
  await assert.rejects(
    createStoryboardPdf(project([scene('s', [chainShot('a', 1)])], { aspectRatio: 0 })),
    /aspect ratio must be a positive number/,
  );
});

// ------------------------------------------------------------------- layouts

test('gives each layout its own page geometry and column count', async () => {
  const scenes = [scene('s', [chainShot('a', 6)])];
  for (const [layout, width, columns] of [
    ['portrait-2up', 595.28, 2],
    ['landscape-2up', 841.89, 2],
    ['landscape-3up', 841.89, 3],
  ]) {
    const pages = await inspect(
      await createStoryboardPdf(project(scenes), { ...BOARD, layout }),
    );
    assert.equal(Math.round(pages[0].width), Math.round(width), layout);
    const rows = new Map();
    for (const item of pages[0].items) {
      if (item.size !== 16 || !/^[A-Z]$/.test(item.text)) continue;
      const key = Math.round(item.y);
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    assert.equal(
      Math.max(...rows.values()),
      columns,
      `${layout} packs ${columns} frames to a row`,
    );
  }
});
