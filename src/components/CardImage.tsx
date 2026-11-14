"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Canonical card art. Falls back to a labelled placeholder when the catalog
 * image 404s (a handful of prints have no upload yet).
 *
 * `photoId` is a person's own photo of the card (`card_photos`): when set it is
 * shown instead of `src`, loaded from the authenticated same-origin route with
 * `unoptimized` (the browser already shrank it, and the optimiser would fetch
 * it without the viewer's cookie), with a small camera badge. If the photo
 * fails to load, the catalog image shows.
 */
export function CardImage({
  src,
  alt,
  sizes = "(min-width: 1024px) 200px, (min-width: 640px) 25vw, 45vw",
  priority = false,
  className = "",
  photoId = null,
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  photoId?: number | null;
}) {
  // Remember *which* src failed, not just that one did: the same instance is
  // reused when its src changes (a leader flipped to its other face, a picker
  // moving to another card), and a plain flag would carry one 404 onto every
  // image it is given afterwards.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const photoSrc = photoId ? `/api/card-photo/${photoId}` : null;
  const showPhoto = photoSrc !== null && failedSrc !== photoSrc;
  const shown = showPhoto ? photoSrc : src;
  if (!shown || failedSrc === shown) {
    return (
      <div className={`ds-card-placeholder card-aspect flex items-center justify-center rounded-lg border border-dashed border-space-600 p-2 text-center text-xs text-space-300 ${className}`}>{alt}</div>
    );
  }
  return (
    <div className={`card-aspect relative overflow-hidden rounded-lg bg-space-900 ${className}`}>
      <Image src={shown} alt={alt} fill sizes={sizes} priority={priority} unoptimized={showPhoto} className="object-contain" onError={() => setFailedSrc(shown)} />
      {showPhoto ? (
        <span className="pointer-events-none absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-space-950/80 text-[11px] leading-none" title="Own photo">
          <span aria-hidden>📷</span>
          <span className="sr-only">Own photo</span>
        </span>
      ) : null}
    </div>
  );
}
