'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { prepareBlobDownload } from '@/lib/storyboard/storage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type DownloadArtifact = {
  url: string;
  filename: string;
  release: () => void;
  markDownloadTriggered: () => void;
};

/** Retains a real download link when the host cannot handle a synthetic click. */
export function useDownload() {
  const [artifact, setArtifact] = useState<DownloadArtifact | null>(null);
  const [open, setOpen] = useState(false);
  const current = useRef<DownloadArtifact | null>(null);
  useEffect(() => () => current.current?.release(), []);

  function prepare(source: Blob | string, filename: string) {
    const prepared =
      typeof source === 'string' ? null : prepareBlobDownload(source, filename);
    const next: DownloadArtifact = prepared ?? {
      url: source as string,
      filename,
      release: () => {},
      markDownloadTriggered: () => {},
    };
    current.current?.release();
    current.current = next;
    setArtifact(next);
    setOpen(true);
    if (prepared) prepared.triggerDownload();
    else {
      const anchor = document.createElement('a');
      anchor.href = next.url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  }

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sb-dialog sb-download-dialog">
        <DialogHeader>
          <DialogTitle>File ready to download</DialogTitle>
          <DialogDescription>{artifact?.filename}</DialogDescription>
        </DialogHeader>
        <p>
          A download was requested. Check your browser’s downloads. If it did
          not start, use the link below.
        </p>
        {artifact && (
          <div className="sb-download-actions">
            <a
              className="sb-download-link"
              href={artifact.url}
              download={artifact.filename}
              onClick={artifact.markDownloadTriggered}
            >
              <Download size={17} /> Download {artifact.filename}
            </a>
            <a
              className="sb-download-open"
              href={artifact.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} /> Open file in a new tab
            </a>
          </div>
        )}
        <p className="sb-hint">
          This link stays available while the page is open. Your browser chooses
          where to save the file.
        </p>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
  return { download: prepare, downloadDialog: dialog };
}
