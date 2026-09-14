'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist';

import { Button } from '@/components/ui/button';
import { calculatePdfScale, type PdfFitMode } from '@/lib/pdf/preview-layout';

import styles from './PdfPreview.module.css';

export interface PdfPreviewProps {
  url: string;
  title?: string;
}

export default function PdfPreview({ url, title = 'Storyboard PDF preview' }: PdfPreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
  const [fitMode, setFitMode] = useState<PdfFitMode>('page');
  const [status, setStatus] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateSize = () => {
      const next = {
        width: Math.max(0, frame.clientWidth - 32),
        height: Math.max(0, frame.clientHeight - 32),
      };
      setAvailableSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();

    void (async () => {
      try {
        await Promise.resolve();
        if (disposed) return;
        setStatus('loading');
        setError('');
        setPageNumber(1);
        setPageCount(0);
        const pdfjs = await import('pdfjs-dist');
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const response = await fetch(url, { signal: controller.signal });
        if (disposed) return;
        if (!response.ok) throw new Error(`The PDF preview could not be loaded (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed) return;
        const loading = pdfjs.getDocument({ data: bytes });
        loadingRef.current = loading;
        const document = await loading.promise;
        if (disposed) {
          settleCleanup(document.destroy());
          return;
        }
        documentRef.current = document;
        setPageCount(document.numPages);
        setDocumentRevision((value) => value + 1);
      } catch (cause) {
        if (disposed || isCancelled(cause)) return;
        setError(cause instanceof Error ? cause.message : 'The PDF preview could not be loaded.');
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      renderRef.current?.cancel();
      renderRef.current = null;
      const loading = loadingRef.current;
      const document = documentRef.current;
      if (document) settleCleanup(document.destroy());
      else if (loading) settleCleanup(loading.destroy());
      documentRef.current = null;
      loadingRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || availableSize.width <= 0 || availableSize.height <= 0 || pageCount === 0) return;
    let disposed = false;
    renderRef.current?.cancel();
    setStatus('rendering');
    setError('');

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (disposed) return;
        const naturalViewport = page.getViewport({ scale: 1 });
        const scale = calculatePdfScale({
          pageWidth: naturalViewport.width,
          pageHeight: naturalViewport.height,
          availableWidth: availableSize.width,
          availableHeight: availableSize.height,
          mode: fitMode,
        });
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('This browser could not create the PDF preview canvas.');

        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const render = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderRef.current = render;
        await render.promise;
        if (!disposed) setStatus('ready');
      } catch (cause) {
        if (disposed || isCancelled(cause)) return;
        setError(cause instanceof Error ? cause.message : 'The PDF page could not be rendered.');
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      renderRef.current?.cancel();
      renderRef.current = null;
    };
  }, [availableSize, documentRevision, fitMode, pageCount, pageNumber]);

  return (
    <section className={styles.preview} aria-label={title} aria-busy={status === 'loading' || status === 'rendering'}>
      <div className={styles.toolbar}>
        <fieldset className={styles.fitControls}>
          <legend className="sr-only">PDF preview size</legend>
          <Button
            variant={fitMode === 'page' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={fitMode === 'page'}
            onClick={() => setFitMode('page')}
          >
            Fit page
          </Button>
          <Button
            variant={fitMode === 'width' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={fitMode === 'width'}
            onClick={() => setFitMode('width')}
          >
            Fit width
          </Button>
        </fieldset>
        <div className={styles.pagination}>
          <Button
            className={styles.navButton}
            variant="outline"
            size="icon-lg"
            aria-label="Previous PDF page"
            disabled={pageNumber <= 1 || status === 'loading'}
            onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
          >
            <ChevronLeft />
          </Button>
          <output className={styles.pageLabel} aria-live="polite">
            {pageCount ? `Page ${pageNumber} of ${pageCount}` : 'Loading pages…'}
          </output>
          <Button
            className={styles.navButton}
            variant="outline"
            size="icon-lg"
            aria-label="Next PDF page"
            disabled={pageNumber >= pageCount || status === 'loading'}
            onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className={styles.frame} ref={frameRef}>
        {(status === 'loading' || status === 'rendering') && (
          <output className={styles.status}>Rendering PDF preview…</output>
        )}
        {error && <div className={styles.error} role="alert">{error}</div>}
        <canvas ref={canvasRef} className={styles.canvas} aria-label={`${title}, page ${pageNumber}`} />
      </div>
    </section>
  );
}

function isCancelled(cause: unknown): boolean {
  return cause instanceof Error && (
    cause.name === 'RenderingCancelledException' ||
    cause.message.includes('Worker was destroyed') ||
    cause.message.includes('Loading aborted')
  );
}

function settleCleanup(result: void | Promise<void>): void {
  void Promise.resolve(result).catch(() => undefined);
}
