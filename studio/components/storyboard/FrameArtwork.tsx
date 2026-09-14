'use client';

/* oxlint-disable next/no-img-element -- Storyboard artwork is stored as portable local data URLs. */

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { ImageTransform, ImageVersion } from '@/lib/storyboard/model';
import {
  getImagePlacement,
  getFrameViewport,
  resolveImageTransform,
} from '@/lib/storyboard/image-transform';
import './image-framing.css';

export default function FrameArtwork({
  image,
  alt,
  className = '',
  interactive = false,
  loading,
  aspectRatio,
  onTransformChange,
}: {
  image: ImageVersion;
  alt: string;
  className?: string;
  interactive?: boolean;
  loading?: 'eager' | 'lazy';
  aspectRatio?: number;
  onTransformChange?: (transform: ImageTransform, historyKey: string) => void;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const transform = resolveImageTransform(image.transform);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const bounds = frame.getBoundingClientRect();
      setFrameSize({ width: bounds.width, height: bounds.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const viewport = getFrameViewport(
    frameSize.width,
    frameSize.height,
    aspectRatio,
  );
  const placement = getImagePlacement(
    imageSize.width,
    imageSize.height,
    viewport.width,
    viewport.height,
    transform,
  );
  const positioned =
    imageSize.width > 0 &&
    imageSize.height > 0 &&
    frameSize.width > 0 &&
    frameSize.height > 0;

  function startDrag(event: PointerEvent<HTMLSpanElement>) {
    if (!interactive || !onTransformChange || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    };
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      !onTransformChange ||
      frameSize.width <= 0 ||
      frameSize.height <= 0
    )
      return;
    event.preventDefault();
    onTransformChange(
      {
        ...transform,
        offsetX: Math.max(
          -1,
          Math.min(
            1,
            drag.offsetX + (event.clientX - drag.clientX) / viewport.width,
          ),
        ),
        offsetY: Math.max(
          -1,
          Math.min(
            1,
            drag.offsetY + (event.clientY - drag.clientY) / viewport.height,
          ),
        ),
      },
      'position',
    );
  }

  function endDrag(event: PointerEvent<HTMLSpanElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <span
      ref={frameRef}
      className={`sb-frame-artwork ${interactive ? 'is-interactive' : ''} ${dragging ? 'is-positioning' : ''} ${className}`.trim()}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title={interactive ? 'Drag to reposition artwork' : undefined}
    >
      <span
        className="sb-artwork-viewport"
        style={
          frameSize.width > 0 && frameSize.height > 0
            ? {
                left: viewport.x,
                top: viewport.y,
                width: viewport.width,
                height: viewport.height,
              }
            : { inset: 0 }
        }
      >
        <img
          draggable={false}
          loading={loading}
          decoding="async"
          src={image.dataUrl}
          alt={alt}
          onLoad={(event) => {
            setImageSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
            const bounds = frameRef.current?.getBoundingClientRect();
            if (bounds)
              setFrameSize({ width: bounds.width, height: bounds.height });
          }}
          style={
            positioned
              ? {
                  left: placement.x,
                  top: placement.y,
                  width: placement.width,
                  height: placement.height,
                  transform: `scale(${placement.flipX ? -1 : 1}, ${placement.flipY ? -1 : 1})`,
                }
              : {
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: transform.fit,
                  transform: `translate(${transform.offsetX * 100}%, ${transform.offsetY * 100}%) scale(${transform.flipX ? -transform.scale : transform.scale}, ${transform.flipY ? -transform.scale : transform.scale})`,
                }
          }
        />
      </span>
    </span>
  );
}
