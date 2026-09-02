"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Canonical card art. Falls back to a labelled placeholder when the catalog
 * image 404s (a handful of prints have no upload yet).
 */
export function CardImage({
  src,
  alt,
  sizes = "(min-width: 1024px) 200px, (min-width: 640px) 25vw, 45vw",
  priority = false,
  className = "",
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={`card-aspect flex items-center justify-center rounded-lg border border-dashed border-space-600 bg-space-900 p-2 text-center text-xs text-space-300 ${className}`}
      >
        {alt}
      </div>
    );
  }
  return (
    <div className={`card-aspect relative overflow-hidden rounded-lg bg-space-900 ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
