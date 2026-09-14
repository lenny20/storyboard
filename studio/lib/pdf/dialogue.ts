export type DialogueLineKind = 'cue' | 'parenthetical' | 'spoken' | 'blank';

export type DialogueLine = {
  kind: DialogueLineKind;
  text: string;
};

const HAS_LETTER = /\p{L}/u;
/** A trailing extension such as `(V.O.)`, `(O.S.)` or `(CONT'D)`. */
const TRAILING_EXTENSION = /\s*\([^()]*\)\s*$/;

function isCueShape(line: string): boolean {
  // A fully parenthesised line is an extension with no name, never a cue.
  const stem = line.replace(TRAILING_EXTENSION, '').trim();
  if (!HAS_LETTER.test(stem)) return false;
  return line === line.toLocaleUpperCase();
}

function isParenthetical(line: string): boolean {
  return line.startsWith('(') && line.endsWith(')');
}

/**
 * Section 7 of the spec. A character cue must be uppercase, contain a letter
 * and be immediately followed by a non-blank line; anything else that is fully
 * parenthesised is a parenthetical; the rest is spoken.
 */
export function parseDialogue(value: string): DialogueLine[] {
  const raw = String(value ?? '').split(/\r\n?|\n/);
  const trimmed = raw.map((line) => line.trim());
  const result: DialogueLine[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    const line = trimmed[index];
    if (!line) {
      result.push({ kind: 'blank', text: '' });
      continue;
    }
    const next = trimmed[index + 1] ?? '';
    if (next && isCueShape(line)) {
      result.push({ kind: 'cue', text: line });
      continue;
    }
    result.push({
      kind: isParenthetical(line) ? 'parenthetical' : 'spoken',
      text: line,
    });
  }
  // Leading and trailing blanks carry no meaning in the caption.
  while (result.length && result[0].kind === 'blank') result.shift();
  while (result.length && result[result.length - 1].kind === 'blank')
    result.pop();
  return result;
}
