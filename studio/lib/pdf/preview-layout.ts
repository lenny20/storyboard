export type PdfFitMode = 'page' | 'width';

export interface PdfScaleInput {
  pageWidth: number;
  pageHeight: number;
  availableWidth: number;
  availableHeight: number;
  mode: PdfFitMode;
}

export function calculatePdfScale({
  pageWidth,
  pageHeight,
  availableWidth,
  availableHeight,
  mode,
}: PdfScaleInput): number {
  const values = [pageWidth, pageHeight, availableWidth, availableHeight];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return 1;

  const widthScale = availableWidth / pageWidth;
  if (mode === 'width') return widthScale;
  return Math.min(widthScale, availableHeight / pageHeight);
}
