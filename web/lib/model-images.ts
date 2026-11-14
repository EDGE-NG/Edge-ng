/**
 * Images sent to the vision model (PRD REQ-LLM-9): downscaled to the size the
 * rules need and cached, so a rule check does not ship up to six 10 MB
 * evidence files plus the live frame on every call.
 *
 * Uses `sharp`, which Next.js installs as its own optional dependency. If it
 * is missing on a platform, the original image is sent unchanged (the old
 * behaviour), so this can only make calls smaller, never break them.
 */
import type { Sharp, SharpOptions } from "sharp";

/** Longest side sent to the model. Chart structure stays readable at this size. */
export const MODEL_MAX_SIDE = 1280;
const CACHE_LIMIT = 300;

type SharpFn = (input?: Buffer, options?: SharpOptions) => Sharp;
let sharpFn: SharpFn | null | undefined;

async function loadSharp(): Promise<SharpFn | null> {
  if (sharpFn !== undefined) return sharpFn;
  try {
    const mod = (await import("sharp")) as unknown as { default?: SharpFn } & SharpFn;
    sharpFn = mod.default ?? mod;
  } catch {
    console.warn("[model-images] sharp is not available; images go to the model at full size");
    sharpFn = null;
  }
  return sharpFn;
}

export interface ModelImage {
  mime: string;
  data: Buffer;
}

/** Downscale (never upscale) and re-encode as WebP. Falls back to the input. */
export async function prepareForModel(data: Buffer, mime: string, maxSide = MODEL_MAX_SIDE): Promise<ModelImage> {
  const sharp = await loadSharp();
  if (!sharp) return { mime, data };
  try {
    const out = await sharp(data)
      .rotate() // respect orientation before any metadata is dropped
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    // keep the original if re-encoding did not help (already small)
    return out.length < data.length ? { mime: "image/webp", data: out } : { mime, data };
  } catch (err) {
    console.warn("[model-images] could not downscale image; sending original:", err);
    return { mime, data };
  }
}

/* Evidence images never change once stored (a replacement is a new image),
 * so their prepared copy is cached by object key. */
const cache = new Map<string, ModelImage>();

export async function cachedForModel(key: string, load: () => Promise<Buffer>, mime: string): Promise<ModelImage> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // refresh LRU position
    cache.set(key, hit);
    return hit;
  }
  const prepared = await prepareForModel(await load(), mime);
  cache.set(key, prepared);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return prepared;
}

export function toDataUrl(img: ModelImage): string {
  return `data:${img.mime};base64,${img.data.toString("base64")}`;
}
