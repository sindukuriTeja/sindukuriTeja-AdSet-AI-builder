import sharp, { OverlayOptions } from "sharp";
import { AdFormat } from "./types";
import { BasePlate } from "./runway";
import { bucketFor, PlateBucket } from "./formats";
import { bestTextColor, isHex } from "./colors";
import { readAsset, saveAsset } from "./storage";
import { withRetry } from "./retry";

// The compositing / "AI layout engine" step: takes a base plate (a wide,
// tall, or square generative background scene) and rebuilds a
// format-specific layout at the exact target pixel size — smart-cropping the
// plate, compositing the real product photo on top, then drawing
// headline/subhead/CTA/logo with typography rules that adapt to how much
// room the format actually has.
//
// Smart cropping uses libvips' built-in "attention" strategy (sharp's
// `fit: cover` + `position: sharp.strategy.attention`), which weights
// high-frequency/high-saturation regions — a solid, dependency-free stand-in
// for a full saliency/object detector. Swapping in a real CV model later is
// a drop-in replacement for `pickCropPosition`.

export interface RenderInput {
  plates: BasePlate[];
  format: AdFormat;
  headline: string;
  subhead?: string;
  cta: string;
  showLegal: boolean;
  legalCopy?: string;
  // Blob URL or local "/uploads/..." path — resolved via lib/storage.ts's
  // readAsset(), which doesn't care which it is.
  logoRef?: string;
  brandPrimary: string; // hex
  bgColorOverride?: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  brandFont?: string; // e.g. "Poppins" — first font from the brand kit, if any
  // The actual uploaded product/hero photo. Composited fresh on top of the
  // background plate on every single render (see compositeProduct below) —
  // the plate (Runway or local fallback) is background-only by design, so
  // the product the customer actually uploaded is always what shows up,
  // never whatever an AI generator happened to draw.
  heroRef?: string;
  outKey: string; // storage key, e.g. "generated/<campaignId>/formats/foo.png"
}

export interface RenderResult {
  url: string;
  basePlateUsed: PlateBucket;
  bgColorUsed: string;
  textColorUsed?: string;
}

// The overlay (headline/subhead/CTA/legal text + logo chip), independent of
// whatever it's composited onto — a static cropped plate for images, or an
// animated pan/zoom background for video (see lib/videoEngine.ts). Keeping
// this as one function means the two renderers can never visually drift
// apart: any future layout fix here applies to both automatically.
export interface OverlayResult {
  composites: OverlayOptions[];
  bg: string;
  textColor: string;
}

export function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Rough character-width heuristic (avg glyph ~0.56x font-size for a
// system UI sans font) — good enough for layout without pulling in a full
// text-shaping library for the MVP.
function wrapText(text: string, fontSizePx: number, boxWidthPx: number, maxLines: number): string[] {
  const avgChar = fontSizePx * 0.56;
  const maxChars = Math.max(4, Math.floor(boxWidthPx / avgChar));
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?]?$/, "") + "…";
  }
  return lines.slice(0, maxLines);
}

function shortenToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

export function pickPlate(plates: BasePlate[], format: AdFormat): BasePlate {
  const wanted = bucketFor(format);
  return plates.find((p) => p.bucket === wanted) || plates[0];
}

// `fit: "inside"` only constrains whichever dimension(s) you pass. Callers
// used to pass width alone, so a tall/square logo resized for a short,
// wide canvas (e.g. the 1200x300 "logo landscape" lockup) could come out
// TALLER than the canvas itself — sharp's composite() hard-rejects an
// overlay bigger than its base image ("Image to composite must have same
// dimensions or smaller"), crashing that format entirely. Always bounding
// both width and height means the logo can only ever shrink to fit.
async function loadLogo(logoRef: string | undefined, targetWidth: number, maxHeight?: number) {
  if (!logoRef) return null;
  let raw: Buffer;
  try {
    raw = await readAsset(logoRef);
  } catch {
    return null;
  }
  // Most uploaded logo files are exported with a solid white/near-white
  // canvas around the mark rather than a tight, transparent-background crop
  // — composited as-is (and then given our own translucent chip behind it,
  // see the "chip" logic below), that extra padding stacks on top of the
  // chip's own padding and reads as one big awkward white slab rather than a
  // neat logo lockup. `.trim()` crops away uniform-color borders based on
  // the corner pixel colour, so what actually gets sized/placed is just the
  // logo art itself — the chip we draw around it afterwards is now the only
  // padding in the final image.
  let trimmed = raw;
  try {
    trimmed = await sharp(raw).trim({ threshold: 12 }).toBuffer();
  } catch {
    // Trim can throw on a fully uniform image (nothing to trim) — fall back
    // to the untrimmed source rather than dropping the logo entirely.
    trimmed = raw;
  }
  const buf = await sharp(trimmed)
    .resize({
      width: Math.round(targetWidth),
      height: maxHeight ? Math.round(maxHeight) : undefined,
      fit: "inside",
    })
    .png()
    .toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, width: meta.width || targetWidth, height: meta.height || targetWidth };
}

// Composites the real, uploaded product photo on top of a cropped
// background plate — called by both renderCreative (images) and
// renderVideoCreative (video, onto its oversized pre-zoompan background) so
// the product is always the actual photo the customer uploaded, sharp and
// correctly represented, no matter what the background generator (Runway or
// the local fallback) produced. See the comment on runwayAttempt in
// lib/runway.ts for why product placement was moved out of plate generation
// entirely and into this single shared step.
//
// `canvasW`/`canvasH` default to the format's own pixel size (the normal
// image-render case); videoEngine.ts passes its oversized pre-zoompan
// dimensions instead so the product lands in the same proportional spot
// once ffmpeg's zoompan settles to a normal 1x crop.
export async function compositeProduct(
  base: Buffer,
  heroRef: string | undefined,
  format: AdFormat,
  canvasW: number = format.width,
  canvasH: number = format.height
): Promise<Buffer> {
  if (!heroRef) return base;
  let heroBuf: Buffer;
  try {
    heroBuf = await readAsset(heroRef);
  } catch {
    return base;
  }

  const scaleX = canvasW / format.width;
  const scaleY = canvasH / format.height;
  const clearSpace = Math.max(10, Math.round(Math.min(format.width, format.height) * (format.safeZonePct ?? 0.08)));
  const isBanner = format.width / format.height >= 3;

  // Reserve the same regions buildOverlay uses for text (the right-hand
  // panel on banners, the bottom scrim on everything else) so the product
  // never sits behind/under copy — it occupies whatever's left.
  let boxW: number, boxH: number, boxLeft: number, boxTop: number;
  if (isBanner) {
    const panelW = Math.round(format.width * 0.4);
    const panelX = format.width - panelW;
    boxW = Math.max(20, panelX - clearSpace * 1.6);
    boxH = Math.max(20, format.height - clearSpace * 1.2);
    boxLeft = clearSpace * 0.8;
    boxTop = (format.height - boxH) / 2;
  } else {
    // Stay entirely ABOVE the text scrim (no overlap with the headline) and
    // clear of the logo chip that sits in the top-left corner.
    const scrimH = format.height * (format.copyTier === "full" ? 0.5 : 0.36);
    const scrimY = format.height - scrimH;
    boxTop = clearSpace * 2.3;
    boxW = format.width * 0.66;
    boxH = Math.max(20, scrimY - boxTop - clearSpace * 0.5);
    boxLeft = (format.width - boxW) / 2;
  }

  let productBuf = await sharp(heroBuf)
    .resize({
      width: Math.max(1, Math.round(boxW * scaleX)),
      height: Math.max(1, Math.round(boxH * scaleY)),
      fit: "inside",
    })
    .png()
    .toBuffer();
  const meta = await sharp(productBuf).metadata();
  const pw = meta.width || Math.round(boxW * scaleX);
  const ph = meta.height || Math.round(boxH * scaleY);

  // Most uploaded product photos are studio shots on a plain white/grey
  // backdrop, not a transparent cutout — composited as-is, that backdrop's
  // straight edges read as an accidental screenshot crop rather than a
  // deliberate design choice. Rounding the corners and dropping a soft
  // shadow underneath turns the same rectangle into a "product card" — a
  // standard, deliberate-looking ad pattern — without needing real
  // background removal.
  const radius = Math.max(8, Math.min(28, Math.round(Math.min(pw, ph) * 0.035)));
  const roundMask = `<svg width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`;
  productBuf = await sharp(productBuf)
    .composite([{ input: Buffer.from(roundMask), blend: "dest-in" }])
    .png()
    .toBuffer();

  const shadowPad = Math.max(6, Math.round(Math.min(pw, ph) * 0.05));
  const shadowOffsetY = Math.round(shadowPad * 0.7);
  const shadowW = pw + shadowPad * 2;
  const shadowH = ph + shadowPad * 2;
  const shadowSvg = `<svg width="${shadowW}" height="${shadowH}">
    <rect x="${shadowPad}" y="${shadowPad + shadowOffsetY}" width="${pw}" height="${ph}" rx="${radius}" ry="${radius}" fill="#000" opacity="0.32" />
  </svg>`;
  const blurSigma = Math.max(0.3, Math.round(shadowPad * 0.6));
  const shadowBuf = await sharp(Buffer.from(shadowSvg)).blur(blurSigma).png().toBuffer();

  const centerLeft = Math.round((boxLeft + boxW / 2) * scaleX - pw / 2);
  const centerTop = Math.round((boxTop + boxH / 2) * scaleY - ph / 2);
  const left = Math.max(0, Math.min(Math.round(canvasW) - pw, centerLeft));
  const top = Math.max(0, Math.min(Math.round(canvasH) - ph, centerTop));
  const shadowLeft = Math.max(0, left - shadowPad);
  const shadowTop = Math.max(0, top - shadowPad);

  // Ensure the shadow fits within the canvas — sharp rejects composites
  // whose dimensions + offset exceed the base image's pixel size.
  let finalShadow = shadowBuf;
  if (shadowLeft + shadowW > Math.round(canvasW) || shadowTop + shadowH > Math.round(canvasH)) {
    const clampedW = Math.min(shadowW, Math.round(canvasW) - shadowLeft);
    const clampedH = Math.min(shadowH, Math.round(canvasH) - shadowTop);
    if (clampedW > 0 && clampedH > 0) {
      finalShadow = await sharp(shadowBuf)
        .extract({ left: 0, top: 0, width: Math.min(shadowW, clampedW), height: Math.min(shadowH, clampedH) })
        .png()
        .toBuffer();
    } else {
      finalShadow = null as any;
    }
  }

  const composites: OverlayOptions[] = [];
  if (finalShadow) composites.push({ input: finalShadow, left: shadowLeft, top: shadowTop });
  composites.push({ input: productBuf, left, top });

  return sharp(base)
    .composite(composites)
    .png()
    .toBuffer();
}

// Builds the headline/subhead/CTA/legal/logo overlay for every format
// EXCEPT the cta_only logo-lockup formats (those have no plate/background
// concept at all — see renderCreative below — and are never video formats,
// so buildOverlay doesn't need to handle that case).
export async function buildOverlay(input: RenderInput): Promise<OverlayResult> {
  const { format } = input;
  const clearSpace = Math.max(10, Math.round(Math.min(format.width, format.height) * (format.safeZonePct ?? 0.08)));
  const fontFamily = input.brandFont ? `'${escapeXml(input.brandFont)}', Arial, sans-serif` : "Arial, sans-serif";

  const isBanner = format.width / format.height >= 3;
  const bg = input.bgColorOverride && isHex(input.bgColorOverride) ? input.bgColorOverride : input.brandPrimary;
  const textColor = bestTextColor(bg);

  const composites: OverlayOptions[] = [];
  let overlaySvg: string;

  if (isBanner) {
    // --- Banner layout: solid brand-color panel + short headline + CTA chip ---
    const panelW = Math.round(format.width * 0.4);
    const panelX = format.width - panelW;
    const fontSize = Math.max(11, Math.round(format.height * 0.26));
    const headline = shortenToWords(input.headline, format.copyTier === "tiny" ? 4 : 6);
    const lines = wrapText(headline, fontSize, panelW - clearSpace * 2, format.height >= 90 ? 2 : 1);
    const lineHeight = fontSize * 1.15;
    const textBlockH = lines.length * lineHeight;
    const startY = format.height / 2 - textBlockH / 2 + fontSize * 0.8;

    const textEls = lines
      .map(
        (line, i) =>
          `<text x="${panelX + clearSpace}" y="${startY + i * lineHeight}" font-family="${fontFamily}" font-weight="700" font-size="${fontSize}" fill="${textColor}">${escapeXml(line)}</text>`
      )
      .join("");

    overlaySvg = `<svg width="${format.width}" height="${format.height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${panelX}" y="0" width="${panelW}" height="${format.height}" fill="${bg}" />
      ${textEls}
    </svg>`;

    composites.push({ input: Buffer.from(overlaySvg), left: 0, top: 0 });

    const logo = await loadLogo(input.logoRef, Math.min(format.height * 1.6, format.width * 0.16), format.height * 0.7);
    if (logo) {
      // Clamp left as well as top: on an extremely narrow/small banner the
      // logo can come out wider than the space to its left, which would
      // otherwise push it past the canvas's right edge.
      const left = Math.max(0, Math.min(format.width - logo.width, clearSpace));
      const top = Math.max(0, Math.min(format.height - logo.height, Math.round((format.height - logo.height) / 2)));
      composites.push({ input: logo.buf, left: Math.round(left), top });
    }
  } else {
    // --- Stack layout: bottom scrim with headline / subhead / CTA, logo opposite corner ---
    const scrimH = Math.round(format.height * (format.copyTier === "full" ? 0.5 : 0.36));
    const scrimY = format.height - scrimH;

    const ctaSize = Math.min(Math.max(11, Math.round(format.width * 0.045)), Math.round(scrimH * 0.13));
    const ctaH = format.copyTier === "tiny" ? 0 : ctaSize * 2.3;
    const showLegalBlock = !!(input.showLegal && input.legalCopy && format.height >= 480);
    const legalSize = showLegalBlock ? Math.max(9, Math.round(format.width * 0.022)) : 0;
    // The old code truncated legal copy by WORD COUNT (14 words) before
    // drawing it as one unbroken <text> line — at this font size, 14 words
    // was regularly wider than the canvas itself, so the tail clipped off
    // the right edge (invisible in the editor, only obvious once exported).
    // wrapText() truncates by actual estimated pixel width instead, so it's
    // guaranteed to fit — kept to exactly 1 line (not 2) so it doesn't eat
    // meaningfully more vertical budget than before and starve the
    // headline's font size on shorter formats.
    const legalLines = showLegalBlock ? wrapText(input.legalCopy!, legalSize, format.width - clearSpace * 2, 1) : [];
    const legalLineHeight = legalSize * 1.35;
    const legalBlockH = legalLines.length > 0 ? legalLines.length * legalLineHeight + legalSize * 0.4 : 0;

    const topPad = clearSpace * 0.8;
    const bottomReserved = (format.copyTier === "tiny" ? 0 : ctaH + clearSpace * 0.6) + legalBlockH;
    const textBudget = Math.max(30, scrimH - topPad - bottomReserved);

    const wantsSubhead = !!input.subhead && format.copyTier === "full" && format.height >= 400;
    const headlineShare = wantsSubhead ? 0.64 : 1;
    const maxHeadlineLines = format.copyTier === "full" ? 2 : format.copyTier === "short" ? 2 : 1;

    const headlineText = format.copyTier === "tiny" ? shortenToWords(input.headline, 4) : input.headline;
    const headlineBudget = textBudget * headlineShare;
    const headlineSize = Math.max(12, Math.min(Math.round(headlineBudget / (maxHeadlineLines * 1.22)), Math.round(format.width * 0.078)));
    const headlineLines = wrapText(headlineText, headlineSize, format.width - clearSpace * 2, maxHeadlineLines);

    let cursorY = scrimY + topPad + headlineSize * 0.85;
    const headlineEls = headlineLines
      .map((line, i) => {
        const y = cursorY + i * headlineSize * 1.22;
        return `<text x="${clearSpace}" y="${y}" font-family="${fontFamily}" font-weight="800" font-size="${headlineSize}" fill="${textColor}">${escapeXml(line)}</text>`;
      })
      .join("");
    cursorY += (headlineLines.length - 1) * headlineSize * 1.22 + headlineSize * 0.5;

    let subheadEls = "";
    if (wantsSubhead) {
      const subheadBudget = textBudget * (1 - headlineShare);
      const subheadSize = Math.max(10, Math.min(Math.round(subheadBudget / (2 * 1.3)), Math.round(format.width * 0.045)));
      const subLines = wrapText(input.subhead!, subheadSize, format.width - clearSpace * 2, 2);
      cursorY += subheadSize * 0.9;
      subheadEls = subLines
        .map((line, i) => {
          const y = cursorY + i * subheadSize * 1.3;
          return `<text x="${clearSpace}" y="${y}" font-family="${fontFamily}" font-weight="400" font-size="${subheadSize}" fill="${textColor}" opacity="0.9">${escapeXml(line)}</text>`;
        })
        .join("");
    }

    const ctaPaddingX = ctaSize * 1.1;
    const ctaW = Math.min(format.width - clearSpace * 2, input.cta.length * ctaSize * 0.62 + ctaPaddingX * 2);
    const ctaY = format.height - clearSpace * 0.6 - legalBlockH - ctaH;
    const ctaTextColor = bestTextColor(input.brandPrimary);

    const ctaEls =
      format.copyTier === "tiny"
        ? ""
        : `<rect x="${clearSpace}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${input.brandPrimary}" />
           <text x="${clearSpace + ctaW / 2}" y="${ctaY + ctaH / 2 + ctaSize * 0.34}" font-family="${fontFamily}" font-weight="700" font-size="${ctaSize}" fill="${ctaTextColor}" text-anchor="middle">${escapeXml(input.cta.toUpperCase())}</text>`;

    const legalStartY = format.height - Math.round(legalSize * 0.6) - (legalLines.length - 1) * legalLineHeight;
    const legalEls = legalLines
      .map(
        (line, i) =>
          `<text x="${clearSpace}" y="${legalStartY + i * legalLineHeight}" font-family="${fontFamily}" font-size="${legalSize}" fill="${textColor}" opacity="0.7">${escapeXml(line)}</text>`
      )
      .join("");

    overlaySvg = `<svg width="${format.width}" height="${format.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${bg}" stop-opacity="0" />
          <stop offset="35%" stop-color="${bg}" stop-opacity="0.55" />
          <stop offset="100%" stop-color="${bg}" stop-opacity="0.92" />
        </linearGradient>
      </defs>
      <rect x="0" y="${scrimY}" width="${format.width}" height="${scrimH}" fill="url(#scrim)" />
      ${headlineEls}
      ${subheadEls}
      ${ctaEls}
      ${legalEls}
    </svg>`;

    composites.push({ input: Buffer.from(overlaySvg), left: 0, top: 0 });

    const logoTargetW = Math.max(48, Math.round(format.width * 0.22));
    const logo = await loadLogo(input.logoRef, logoTargetW, format.height * 0.45);
    if (logo) {
      const chipPad = clearSpace * 0.6;
      const chipW = Math.min(format.width, Math.round(logo.width + chipPad * 2));
      const chipH = Math.min(format.height, Math.round(logo.height + chipPad * 2));
      // Small translucent chip behind the logo so it stays legible over busy photos.
      const chip = await sharp({
        create: {
          width: chipW,
          height: chipH,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 217 },
        },
      })
        .composite([{ input: logo.buf, gravity: "center" }])
        .png()
        .toBuffer();

      const pos = input.logoPosition;
      const rawLeft = pos.includes("right") ? format.width - chipW - clearSpace : pos === "center" ? Math.round((format.width - chipW) / 2) : clearSpace;
      const rawTop = pos.includes("bottom") ? scrimY - chipH - clearSpace / 2 : pos === "center" ? Math.round((format.height - chipH) / 2) : clearSpace;
      const left = Math.max(0, Math.min(format.width - chipW, Math.round(rawLeft)));
      const top = Math.max(0, Math.min(format.height - chipH, Math.round(rawTop)));
      composites.push({ input: chip, left, top });
    }
  }

  return { composites, bg, textColor };
}

export async function renderCreative(input: RenderInput): Promise<RenderResult> {
  const { format } = input;
  const plate = pickPlate(input.plates, format);

  // --- Pure logo-lockup formats (Google "logo square/landscape" assets) ---
  if (format.copyTier === "cta_only") {
    const bg = input.bgColorOverride && isHex(input.bgColorOverride) ? input.bgColorOverride : "#ffffff";
    const logo = await loadLogo(input.logoRef, format.width * 0.5, format.height * 0.7);
    const canvas = sharp({
      create: { width: format.width, height: format.height, channels: 4, background: bg },
    });
    const composites: OverlayOptions[] = [];
    if (logo) composites.push({ input: logo.buf, gravity: "center" });
    const buf = await withRetry(() => canvas.composite(composites).png().toBuffer());
    const url = await saveAsset(buf, input.outKey, "image/png");
    return { url, basePlateUsed: plate.bucket, bgColorUsed: bg };
  }

  // --- Smart crop the plate to the exact target size ---
  const plateBuf = await readAsset(plate.url);
  const base = await withRetry(() =>
    sharp(plateBuf)
      .resize(format.width, format.height, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .toBuffer()
  );

  // Composite the real product photo on top of the background before the
  // text/logo overlay goes on — see compositeProduct() above.
  const baseWithProduct = await compositeProduct(base, input.heroRef, format);

  const { composites, bg, textColor } = await buildOverlay(input);

  const finalBuf = await withRetry(() => sharp(baseWithProduct).composite(composites).png().toBuffer());
  const url = await saveAsset(finalBuf, input.outKey, "image/png");
  return { url, basePlateUsed: plate.bucket, bgColorUsed: bg, textColorUsed: textColor };
}
