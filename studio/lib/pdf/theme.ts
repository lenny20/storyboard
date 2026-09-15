import { rgb, type PDFFont } from 'pdf-lib';

/** Colour tokens of the export design spec, section 2. */
function hex(value: string): ReturnType<typeof rgb> {
  const red = Number.parseInt(value.slice(1, 3), 16) / 255;
  const green = Number.parseInt(value.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(value.slice(5, 7), 16) / 255;
  return rgb(red, green, blue);
}

export const COLORS = {
  ground: hex('#161616'),
  frameGround: hex('#000000'),
  pendingGround: hex('#1F1F1F'),
  ink: hex('#ECE8DF'),
  secondary: hex('#A8A297'),
  muted: hex('#8F8A80'),
  accent: hex('#C9A24A'),
  rule: hex('#333029'),
} as const;

export type Color = ReturnType<typeof rgb>;

/** The bundled faces. Nothing outside this list is embedded. */
export type FontRole =
  | 'condensedLight'
  | 'condensedMedium'
  | 'condensedSemiBold'
  | 'regular'
  | 'medium'
  | 'mono';

export type Fonts = Record<FontRole, PDFFont>;

export type TextStyle = {
  font: FontRole;
  size: number;
  leading: number;
  color: Color;
  /** Extra advance per glyph, in points. Section 3 quotes these in em. */
  tracking: number;
  uppercase: boolean;
};

function style(
  font: FontRole,
  size: number,
  leading: number,
  color: Color,
  extra: { trackingEm?: number; uppercase?: boolean } = {},
): TextStyle {
  return {
    font,
    size,
    leading,
    color,
    tracking: (extra.trackingEm ?? 0) * size,
    uppercase: extra.uppercase ?? false,
  };
}

/** The complete type scale of section 3. Nothing else is used. */
export const TYPE = {
  shotNumeral: style('condensedLight', 44, 40, COLORS.ink),
  shotNumeralShared: style('condensedLight', 28, 26, COLORS.ink),
  kicker: style('condensedMedium', 8, 11, COLORS.muted, {
    trackingEm: 0.22,
    uppercase: true,
  }),
  panelLetter: style('condensedSemiBold', 16, 15, COLORS.accent),
  action: style('regular', 10, 14, COLORS.ink),
  cameraNote: style('regular', 9.5, 13.5, COLORS.secondary),
  /** `CAMERA` / `NOTE` before a caption field: same size and family as the note it labels. */
  fieldLabel: style('medium', 9.5, 13.5, COLORS.accent, {
    trackingEm: 0.06,
    uppercase: true,
  }),
  dialogue: style('mono', 9.5, 13.5, COLORS.ink),
  railType: style('condensedMedium', 8, 11, COLORS.accent, {
    trackingEm: 0.14,
    uppercase: true,
  }),
  railDescription: style('medium', 8.5, 11, COLORS.ink),
  railEndpoint: style('condensedMedium', 9, 11, COLORS.ink),
  coverKicker: style('condensedMedium', 8, 11, COLORS.accent, {
    trackingEm: 0.22,
    uppercase: true,
  }),
  coverTitle: style('condensedLight', 66, 60, COLORS.ink),
  coverMeta: style('regular', 10.5, 15, COLORS.secondary),
  coverContentsNumber: style('condensedLight', 18, 18, COLORS.accent),
  coverContentsTitle: style('regular', 10, 14, COLORS.ink),
} as const;

/** A kicker in a colour other than the default muted. */
export function tinted(base: TextStyle, color: Color): TextStyle {
  return { ...base, color };
}

/**
 * Baseline of a line of this style hanging from `top`. The leading is split
 * evenly above and below the glyph box; Barlow and Courier Prime both sit close
 * to 0.78 em below the glyph box top at these sizes.
 */
export function baselineFrom(top: number, value: TextStyle): number {
  return top - (value.leading - value.size) / 2 - value.size * 0.78;
}
