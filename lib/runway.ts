import sharp from "sharp";
import RunwayML, { TaskFailedError } from "@runwayml/sdk";
import { PlateBucket } from "./formats";
import { withRetry } from "./retry";
import { isHex } from "./colors";
import { readAsset, saveAsset } from "./storage";
import type { CreativeConcept } from "./claude";

// ─── Runway scene generation ─────────────────────────────────────────────────
//
// Each ad format gets its own Runway gen4_image call.
// Claude writes the complete scene prompt — athlete/action, environment,
// lighting, AND the product placed naturally in the frame.
// Runway renders the full photorealistic image as one shot.
// The render engine then overlays only text + logo on top.
//
// This is how the Red Bull reference images work:
//   • Parkour athlete leaping at golden hour, Red Bull can on the ledge
//   • Mountain biker carving alpine trail, Red Bull can on the rocks
// — all one complete AI-generated photo, not composited layers.
//
// Keys: RUNWAY_API_KEY or legacy RUNWAYML_API_SECRET.

// Runway gen4_image supported ratios — pick the closest to each format bucket:
const RATIO_BY_BUCKET: Record<PlateBucket, string> = {
  square:              "1080:1080",
  landscape_wide:      "1280:720",
  landscape_ultrawide: "1920:1080",
  portrait:            "1080:1920",
  portrait_tall:       "720:1280",
};

export interface BasePlate {
  bucket: PlateBucket;
  url: string;
  source: "runway" | "mock";
}

let _runwayClient: RunwayML | null = null;
let _keyLogged = false;

function client(): RunwayML | null {
  const apiKey = process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET;
  if (!apiKey) {
    console.warn("[runway] ⚠️  No API key — using gradient fallback for all formats");
    return null;
  }
  if (!_keyLogged) {
    console.log(`[runway] API key ${apiKey.slice(0, 14)}… loaded`);
    _keyLogged = true;
  }
  if (!_runwayClient) {
    _runwayClient = new RunwayML({ apiKey, timeout: 180_000 });
  }
  return _runwayClient;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("timeout") || m.includes("econnreset") || m.includes("econnrefused")
    || m.includes("etimedout") || m.includes("socket hang up") || m.includes("network");
}

// ─── Mock fallback ───────────────────────────────────────────────────────────
// When Runway is unavailable produce a clean dark studio gradient with a
// brand-colour spotlight — NOT a blurred photo smear.
async function mockScene(
  bucket: PlateBucket,
  brandPrimary?: string,
): Promise<Buffer> {
  const [w, h] = RATIO_BY_BUCKET[bucket].split(":").map(Number);
  const targetW = 1440;
  const targetH = Math.round((h / w) * targetW);

  const accent = brandPrimary && isHex(brandPrimary) ? brandPrimary : "#c8102e";
  const rr = parseInt(accent.slice(1, 3), 16);
  const gg = parseInt(accent.slice(3, 5), 16);
  const bb = parseInt(accent.slice(5, 7), 16);

  const svg = `<svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#0c0c14"/>
        <stop offset="100%" stop-color="#13131e"/>
      </linearGradient>
      <radialGradient id="spot" cx="50%" cy="40%" r="52%">
        <stop offset="0%"   stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0.28"/>
        <stop offset="50%"  stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0.09"/>
        <stop offset="100%" stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
        <stop offset="55%"  stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.60"/>
      </linearGradient>
      <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0"/>
        <stop offset="25%"  stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0.95"/>
        <stop offset="75%"  stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="rgb(${rr},${gg},${bb})" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${targetW}" height="${targetH}" fill="url(#bg)"/>
    <rect width="${targetW}" height="${targetH}" fill="url(#spot)"/>
    <rect width="${targetW}" height="${targetH}" fill="url(#vignette)"/>
    <rect x="0" y="${targetH - 4}" width="${targetW}" height="4" fill="url(#accentLine)"/>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Download a Runway output URL ────────────────────────────────────────────
async function downloadRunwayImage(url: string): Promise<Buffer> {
  return withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Runway download HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("Runway download empty");
    await sharp(buf).metadata(); // validate it's a real image
    return buf;
  });
}

// ─── Single Runway call ───────────────────────────────────────────────────────
async function runwayGenerate(
  runway: RunwayML,
  bucket: PlateBucket,
  scenePrompt: string,
): Promise<string> {
  // Build the final prompt:
  // Claude's complete scene (includes product placement) + quality modifiers.
  // Explicitly block text/logos/UI since those are composited separately.
  const fullPrompt = `${scenePrompt.trim()} `
    + `Photorealistic advertising photography, ultra-sharp, professional lighting, `
    + `cinematic colour grade, high production value. `
    + `No text, no words, no letters, no logos, no watermarks, no UI elements.`;

  const body: Record<string, unknown> = {
    model: "gen4_image",
    ratio: RATIO_BY_BUCKET[bucket],
    promptText: fullPrompt,
  };

  // The Runway SDK's .create() returns a waitable Promise — a Promise that
  // also has .waitForTaskOutput() attached directly on it (before awaiting).
  // Awaiting .create() resolves to a plain {id} task stub with NO
  // .waitForTaskOutput() on it — that method only exists on the Promise wrapper.
  // Correct pattern: call .waitForTaskOutput() on the un-awaited Promise.
  const result = await runway.textToImage.create(body as any).waitForTaskOutput();
  const imageUrl = (result as any).output?.[0];
  if (!imageUrl) throw new Error("Runway returned no output URL");
  return imageUrl;
}

// ─── Public: generate scene for one format ───────────────────────────────────
export async function generateSceneForFormat(
  formatId: string,
  campaignId: string,
  bucket: PlateBucket,
  concept: CreativeConcept,
  brandPrimary?: string,
): Promise<BasePlate> {
  const runway = client();
  const key = `generated/${campaignId}/scenes/${formatId}.png`;

  if (runway && concept.scenePrompt?.trim()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const imageUrl = await runwayGenerate(runway, bucket, concept.scenePrompt);
        const buf = await downloadRunwayImage(imageUrl);
        const url = await saveAsset(buf, key, "image/png");
        console.log(`[runway] ✓ ${formatId} — scene "${concept.sceneTag}" generated`);
        return { bucket, url, source: "runway" };
      } catch (err) {
        if (err instanceof TaskFailedError) {
          const detail = JSON.stringify((err as any).taskDetails ?? err.message);
          console.error(`[runway] ✗ ${formatId} — Runway task failed: ${detail}`);
          break; // content moderation / model error — don't retry
        }
        const msg = (err as Error).message ?? String(err);
        if (isRetryable(err) && attempt < 2) {
          console.warn(`[runway] ${formatId} attempt ${attempt} network error, retrying in 5s… (${msg})`);
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          console.error(`[runway] ✗ ${formatId} attempt ${attempt} — ${msg} — using fallback`);
          break;
        }
      }
    }
  } else if (!concept.scenePrompt?.trim()) {
    console.warn(`[runway] ${formatId} — no scenePrompt, using gradient fallback`);
  }

  // Gradient fallback
  const buf = await mockScene(bucket, brandPrimary);
  const url = await saveAsset(buf, key, "image/png");
  return { bucket, url, source: "mock" };
}

// ─── Legacy: shared base plates (kept for existing campaigns) ────────────────
const PLATE_BUCKETS: PlateBucket[] = [
  "square", "landscape_wide", "landscape_ultrawide", "portrait", "portrait_tall",
];

export async function generateBasePlates(
  heroRef: string,
  campaignId: string,
  campaignName: string,
  brandPrimary?: string,
  creativeDirection?: string,
): Promise<BasePlate[]> {
  const runway = client();
  const heroBuf = await readAsset(heroRef);
  return Promise.all(
    PLATE_BUCKETS.map(async (bucket) => {
      const key = `generated/${campaignId}/plates/plate_${bucket}.png`;
      if (runway) {
        const brandCtx = creativeDirection ? `${creativeDirection}. ` : "";
        try {
          const imageUrl = await runwayGenerate(
            runway,
            bucket,
            `${brandCtx}Premium advertising lifestyle background for a "${campaignName}" campaign. ` +
            `Cinematic environment with generous open space for copy. No people, no products.`,
          );
          const buf = await downloadRunwayImage(imageUrl);
          const url = await saveAsset(buf, key, "image/png");
          return { bucket, url, source: "runway" as const };
        } catch (err) {
          console.error(`[runway] legacy plate ${bucket} failed:`, (err as Error).message);
        }
      }
      const buf = await mockScene(bucket, brandPrimary);
      const url = await saveAsset(buf, key, "image/png");
      return { bucket, url, source: "mock" as const };
    }),
  );
}
