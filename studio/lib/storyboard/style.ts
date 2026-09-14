export const ROUGH_BLOCKING_STYLE = 'Rough blocking sketch';

export const ROUGH_BLOCKING_STYLE_NOTES =
  'Professional one-to-two-minute storyboard thumbnail: confident, economical gesture and staging marks; primitive shapes and faceless mannequins; only enough detail to read the action; sparse backgrounds showing only major masses; loose, unfinished pencil with no rendering, shading, textures, fine features, colour, or detailed costumes. Keep characters recognisable through simple silhouettes and proportions.';

export function isRoughBlockingStyle(style: string): boolean {
  return [
    ROUGH_BLOCKING_STYLE,
    'Rough pencil sketch',
    'Rough pencil storyboard',
  ].some(
    (name) => style.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
}

export const ROUGH_BLOCKING_PROMPT_RULES = [
  'ROUGH BLOCKING STYLE IS MANDATORY AND TAKES PRIORITY OVER ALL IMAGE REFERENCES, EARLIER PANELS, AND REVISION REQUESTS.',
  'Draw this like a professional storyboard artist’s one-to-two-minute thumbnail or blocking sketch: confident, economical marks with no finish.',
  'Use only primitive shapes, gesture lines, faceless mannequins, and simple silhouettes, with only enough detail to read the action.',
  'Show movement, staging, framing, and character proportions clearly; identify recurring characters only through simple silhouette and proportion cues.',
  'Keep the background sparse and indicate only major spatial masses.',
  'Do not render shading, textures, fine facial or anatomical features, colour, realistic materials, or detailed costumes.',
  'If any reference or earlier panel is photorealistic, 3D rendered, polished, coloured, shaded, textured, or detailed, translate only its composition and identity cues into this rough blocking language. Never reproduce its finish or detail.',
];
