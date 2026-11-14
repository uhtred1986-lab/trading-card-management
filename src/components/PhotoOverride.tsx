"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCardPhotoAction, saveCardPhotoAction } from "@/app/cards/photo-actions";
import { CardImage } from "./CardImage";

export interface PhotoOverrideLabels {
  title: string;
  take: string;
  retake: string;
  original: string;
  saving: string;
  removing: string;
  errorRead: string;
  errorEncode: string;
  errorTooLarge: string;
  errorSave: string;
}

const EN: PhotoOverrideLabels = {
  title: "Own photo",
  take: "Take photo",
  retake: "Replace photo",
  original: "Show original",
  saving: "Saving…",
  removing: "Removing…",
  errorRead: "That file could not be read as a picture.",
  errorEncode: "This browser could not shrink the picture.",
  errorTooLarge: "The picture is still too large after shrinking.",
  errorSave: "The photo could not be saved.",
};

/** Same limit as the server (`MAX_PHOTO_BYTES`); a client file cannot import the server library. */
const MAX_BYTES = 400 * 1024;
const WIDTH = 750;
const RATIO = 63 / 88;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Centre-crops to the card ratio (63:88), scales to 750 px wide, and encodes
 * WebP at quality 0.8 (JPEG where the browser cannot encode WebP), retrying at
 * lower quality and then smaller until under 400 KB. No library.
 */
export async function shrinkCardPhoto(file: File): Promise<Blob> {
  const img = await decode(file);
  try {
    let cropW = img.width;
    let cropH = Math.round(cropW / RATIO);
    if (cropH > img.height) {
      cropH = img.height;
      cropW = Math.round(cropH * RATIO);
    }
    const sx = Math.round((img.width - cropW) / 2);
    const sy = Math.round((img.height - cropH) / 2);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("encode");
    for (let width = Math.min(WIDTH, cropW); width >= 300; width = Math.round(width * 0.8)) {
      canvas.width = width;
      canvas.height = Math.round(width / RATIO);
      ctx.drawImage(img.source, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.7, 0.6, 0.5, 0.4]) {
        let blob = await toBlob(canvas, "image/webp", quality);
        // A browser that cannot encode WebP silently answers PNG.
        if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
        if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) throw new Error("encode");
        if (blob.size <= MAX_BYTES) return blob;
      }
    }
    throw new Error("large");
  } finally {
    img.close();
  }
}

/**
 * The "own photo" control of one print: the current picture as a thumbnail, a
 * button that opens the phone's camera, and "show original" to drop the photo.
 * `labels` defaults to English; other screens pass their own language.
 */
export function PhotoOverride({
  printId,
  photoId,
  imageUrl,
  alt,
  labels,
  className = "",
}: {
  printId: string;
  /** The viewer's current photo of this print, if any. */
  photoId: number | null;
  /** The catalog picture, for the thumbnail when there is no photo. */
  imageUrl: string | null | undefined;
  alt: string;
  labels?: Partial<PhotoOverrideLabels>;
  className?: string;
}) {
  const t = { ...EN, ...labels };
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<number | null>(photoId);
  const [shownFrom, setShownFrom] = useState<number | null>(photoId);
  const [busy, setBusy] = useState<"saving" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // A new server value (after a refresh) wins over what this instance remembers.
  if (shownFrom !== photoId) {
    setShownFrom(photoId);
    setCurrent(photoId);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("saving");
    try {
      let blob: Blob;
      try {
        blob = await shrinkCardPhoto(file);
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        setError(m === "large" ? t.errorTooLarge : m === "encode" ? t.errorEncode : t.errorRead);
        return;
      }
      const form = new FormData();
      form.set("printId", printId);
      form.set("photo", new File([blob], blob.type === "image/webp" ? "photo.webp" : "photo.jpg", { type: blob.type }));
      const res = await saveCardPhotoAction(form);
      if (!res.ok) setError(res.code === "too_large" ? t.errorTooLarge : t.errorSave);
      else {
        setCurrent(res.photoId);
        startTransition(() => router.refresh());
      }
    } catch {
      setError(t.errorSave);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function original() {
    setError(null);
    setBusy("removing");
    try {
      const res = await removeCardPhotoAction(printId);
      if (!res.ok) setError(t.errorSave);
      else {
        setCurrent(null);
        startTransition(() => router.refresh());
      }
    } catch {
      setError(t.errorSave);
    } finally {
      setBusy(null);
    }
  }

  const btn = "tap inline-flex items-center justify-center rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400 disabled:opacity-50";
  return (
    <div className={`rounded-xl border border-space-700/70 bg-space-900/60 p-3 text-sm ${className}`}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-space-300">{t.title}</div>
      <div className="flex items-center gap-3">
        <div className="w-16 shrink-0">
          <CardImage src={imageUrl} photoId={current} alt={alt} sizes="64px" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2">
          <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" className={btn} disabled={busy !== null} onClick={() => input.current?.click()}>
            {busy === "saving" ? t.saving : current ? t.retake : t.take}
          </button>
          {current ? (
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void original()}>
              {busy === "removing" ? t.removing : t.original}
            </button>
          ) : null}
        </div>
      </div>
      <p role="status" aria-live="polite" className={error ? "mt-2 text-xs text-loss" : "sr-only"}>
        {error}
      </p>
    </div>
  );
}
