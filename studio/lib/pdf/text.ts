import {
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { Color, Fonts, TextStyle } from './theme';

/** Normalises to NFC and drops control characters the PDF text operators reject. */
export function pdfSafe(value: string): string {
  const normalized = String(value ?? '').normalize('NFC');
  let output = '';
  for (const character of normalized) {
    if (character === ' ') {
      output += ' ';
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    const printable =
      code >= 32 ||
      character === '\n' ||
      character === '\r' ||
      character === '\t';
    if (printable) output += character;
  }
  return output.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

const fontCharacters = new WeakMap<PDFFont, Set<number>>();

/** Raises the actionable export error rather than silently dropping a glyph. */
export function safeForFont(value: string, font: PDFFont): string {
  let characters = fontCharacters.get(font);
  if (!characters) {
    characters = new Set(font.getCharacterSet());
    fontCharacters.set(font, characters);
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (characters.has(code) || character === '\n' || character === '\r')
      continue;
    const codeLabel = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    throw new Error(
      `Cannot export PDF: the bundled font cannot render character "${character}" (${codeLabel}). Replace that character and try again.`,
    );
  }
  return value;
}

/** Applies the style's case rule and cleans the text for the PDF. */
export function prepare(value: string, style: TextStyle): string {
  const clean = pdfSafe(value);
  return style.uppercase ? clean.toLocaleUpperCase() : clean;
}

/**
 * Visible width of one line. The trailing tracking advance is excluded so that
 * centred and right-aligned text sits where the eye expects it.
 */
export function measureText(
  value: string,
  style: TextStyle,
  fonts: Fonts,
): number {
  const text = prepare(value, style);
  if (!text) return 0;
  const font = fonts[style.font];
  safeForFont(text, font);
  const glyphs = Array.from(text).length;
  return (
    font.widthOfTextAtSize(text, style.size) +
    Math.max(0, glyphs - 1) * style.tracking
  );
}

/** Wraps one paragraph. Explicit line breaks are handled by `wrapText`. */
function wrapParagraph(
  value: string,
  style: TextStyle,
  fonts: Fonts,
  maxWidth: number,
): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (const piece of breakLongWord(word, style, fonts, maxWidth)) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (!line || measureText(candidate, style, fonts) <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = piece;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Splits a single word that cannot fit on a line of its own. */
function breakLongWord(
  word: string,
  style: TextStyle,
  fonts: Fonts,
  maxWidth: number,
): string[] {
  if (maxWidth <= 0) return [word];
  if (measureText(word, style, fonts) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = '';
  for (const character of word) {
    const candidate = piece + character;
    if (piece && measureText(candidate, style, fonts) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Wraps text to `maxWidth`, keeping the source's own line breaks. */
export function wrapText(
  value: string,
  style: TextStyle,
  fonts: Fonts,
  maxWidth: number,
): string[] {
  const text = prepare(value, style);
  if (!text.trim()) return [];
  return text
    .split('\n')
    .flatMap((paragraph) =>
      paragraph.trim()
        ? wrapParagraph(paragraph, style, fonts, maxWidth)
        : [''],
    );
}

export type DrawTextOptions = {
  align?: 'left' | 'center' | 'right';
  color?: Color;
};

/** Draws one line with the style's tracking applied through the text state. */
export function drawLine(
  page: PDFPage,
  value: string,
  x: number,
  baseline: number,
  style: TextStyle,
  fonts: Fonts,
  options: DrawTextOptions = {},
): number {
  const text = prepare(value, style);
  if (!text) return 0;
  const font = fonts[style.font];
  safeForFont(text, font);
  const width = measureText(text, style, fonts);
  const align = options.align ?? 'left';
  const left =
    align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const tracked = style.tracking !== 0;
  if (tracked)
    page.pushOperators(pushGraphicsState(), setCharacterSpacing(style.tracking));
  page.drawText(text, {
    x: left,
    y: baseline,
    font,
    size: style.size,
    color: options.color ?? style.color,
  });
  if (tracked) page.pushOperators(popGraphicsState());
  return width;
}
