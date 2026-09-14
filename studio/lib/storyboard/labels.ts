/** Human-readable display codes. Inputs are one-based positions in the project. */
const number = (value: number): string => String(value).padStart(2, '0');

/** Presents a lower-case movement code without changing its stored value. */
export function formatMovementLabel(value: string): string {
  const words = value.replaceAll('-', ' ');
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : words;
}

/** Panel letters restart within each shot and continue A…Z, AA, AB, etc. */
export function formatPanelLetter(panelNumber: number): string {
  let remainder = panelNumber;
  let result = '';
  while (remainder > 0) {
    remainder -= 1;
    result = String.fromCharCode(65 + (remainder % 26)) + result;
    remainder = Math.floor(remainder / 26);
  }
  return result;
}

export function formatShotCode(
  sceneNumber: number,
  shotNumber: number,
): string {
  return `SC${number(sceneNumber)} · SH${number(shotNumber)}`;
}

/** A single drawing is identified by its shot; multiple drawings add a panel letter. */
export function formatPanelCode(
  sceneNumber: number,
  shotNumber: number,
  panelNumber: number,
  panelCount: number,
): string {
  const shot = formatShotCode(sceneNumber, shotNumber);
  return panelCount > 1 ? `${shot} · ${formatPanelLetter(panelNumber)}` : shot;
}
