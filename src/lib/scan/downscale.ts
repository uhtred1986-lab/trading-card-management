/**
 * Browser-side resize before upload. Phone photos are 3-8 MB each; several at
 * once would exceed Vercel's request body limit and be slow on mobile data.
 * The server resizes to the same edge anyway, so nothing is lost, and the
 * preview the user sees is exactly what Claude saw, so bounding boxes line up.
 */
export const SCAN_MAX_EDGE = 1568;

export interface Downscaled {
  blob: Blob;
  width: number;
  height: number;
}

export async function downscaleImage(file: File, maxEdge = SCAN_MAX_EDGE): Promise<Downscaled> {
  const url = URL.createObjectURL(file);
  try {
    // <img> applies EXIF orientation, so the canvas ends up upright.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image"));
      el.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, width, height };
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return { blob: blob ?? file, width, height };
  } catch {
    // Undecodable in this browser (e.g. HEIC on Chrome): send the original and let sharp try.
    return { blob: file, width: 0, height: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
