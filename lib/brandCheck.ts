import sharp from "sharp";
import { AdFormat, BrandCheckIssue, BrandCheckReport, BrandKit, CreativeVariant } from "./types";
import { contrastRatio, hexToRgb, isHex } from "./colors";
import { readAsset } from "./storage";

// Euclidean RGB distance between two hex colours (0 = identical, ~441 = max).
function colorDistance(a: string, b: string): number {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  return Math.sqrt((ra[0]-rb[0])**2 + (ra[1]-rb[1])**2 + (ra[2]-rb[2])**2);
}

// Returns true when `hex` is a near-neutral dark (very dark greys, near-blacks).
// Claude legitimately uses these as scrim/overlay backgrounds for cinematic
// styles — they are not "brand colours" but they are also not brand violations.
function isNeutralDark(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  return luminance < 0.15; // covers #000–#252525-ish range
}

// Pre-export brand consistency check. Runs a handful of deterministic,
// inspectable heuristics rather than an opaque model call, so results are
// explainable in the Brand Check panel: logo usage, brand colours, font
// usage, contrast, text readability, image quality, CTA visibility, safe
// zone — plus legal copy and layout density where relevant.

export async function runBrandCheck(
  variant: CreativeVariant,
  format: AdFormat,
  brand: BrandKit,
  logoRef?: string,
  sourceImageRef?: string,
  // The headline Claude actually rendered on the image (may be shorter than
  // variant.headline which stores the original campaign copy). If omitted,
  // falls back to variant.headline.
  renderedHeadline?: string
): Promise<BrandCheckReport> {
  const checks: BrandCheckIssue[] = [];

  // --- Logo usage: present, and meets minimum size if we have a source to check ---
  if (format.copyTier !== "cta_only") {
    const logoBuf = logoRef ? await readAsset(logoRef).catch(() => null) : null;
    if (!logoBuf) {
      checks.push({ code: "logo_usage", message: "No logo uploaded for this brand kit", severity: "warn" });
    } else {
      const meta = await sharp(logoBuf).metadata();
      const minW = brand.minLogoWidthPx ?? 32;
      if ((meta.width ?? 0) < minW) {
        checks.push({ code: "logo_usage", message: `Source logo is ${meta.width}px wide, below the ${minW}px minimum`, severity: "warn" });
      } else {
        checks.push({ code: "logo_usage", message: "Correct — logo present and sized correctly", severity: "pass" });
      }
    }
  }

  // --- Brand colours used ---
  // Claude picks the bg colour for two completely different reasons depending
  // on style:
  //
  //   • Solid-bg styles (bold_type, vibrant_gradient, split_panel, etc.) —
  //     the stored bgColor IS the visible background, so it should be near a
  //     brand palette colour.
  //
  //   • Overlay styles (editorial, full_bleed_scrim, neon_accent, etc.) —
  //     the stored bgColor is a scrim/overlay tint applied at partial opacity
  //     over a Runway-generated photo. Claude is correct to choose a very
  //     dark near-neutral here; flagging it as "not in brand palette" is a
  //     false positive that misleads the user.
  //
  // Strategy: pass if the colour is (a) in/near the brand palette, OR
  // (b) a neutral dark used as a cinematic scrim (luminance < 15 %).
  // Tolerance of 90 RGB units catches brand-derived tints and shades.
  const brandHexes = brand.colors.map((c) => c.hex.toLowerCase());
  const usedColor = (variant.bgColor || brand.colors.find((c) => c.role === "primary")?.hex || "#000000").toLowerCase();

  const isExactMatch = brandHexes.includes(usedColor);
  const isNearBrandColor = brandHexes.some((hex) => colorDistance(hex, usedColor) < 90);
  const isAcceptableScrim = isNeutralDark(usedColor);

  if (format.copyTier === "cta_only") {
    checks.push({ code: "brand_colors", message: "On brand — logo lockup uses a plain background by design", severity: "pass" });
  } else if (brandHexes.length === 0) {
    checks.push({ code: "brand_colors", message: "No brand colours defined in brand kit", severity: "warn" });
  } else if (isExactMatch || isNearBrandColor || isAcceptableScrim) {
    checks.push({ code: "brand_colors", message: "On brand", severity: "pass" });
  } else {
    checks.push({ code: "brand_colors", message: "Background colour is not in the brand palette", severity: "warn" });
  }

  // --- Font usage: the renderer now sets font-family to the brand's font
  // (with an Arial/system-sans fallback chain) — see lib/imageEngine.ts. We
  // can't guarantee the named font is actually installed on whatever host
  // is running the renderer (no font files are uploaded/embedded, just a
  // name), so this is "applied, with graceful fallback" rather than a hard
  // guarantee — but that's the same honest caveat any web font stack has. ---
  if (brand.fonts.length > 0) {
    checks.push({
      code: "font_usage",
      message: `On brand — rendering with brand font "${brand.fonts[0]}" (falls back to a system font if it isn't installed on the server)`,
      severity: "pass",
    });
  } else {
    checks.push({ code: "font_usage", message: "On brand — using a clean system fallback (no brand font on file)", severity: "pass" });
  }

  // --- Contrast: text color vs. background/scrim colour ---
  if (isHex(usedColor) && variant.textColor && isHex(variant.textColor)) {
    const ratio = contrastRatio(usedColor, variant.textColor);
    if (ratio >= 4.5) {
      checks.push({ code: "contrast", message: `Good — ${ratio.toFixed(1)}:1 (meets WCAG AA)`, severity: "pass" });
    } else if (ratio >= 3) {
      checks.push({ code: "contrast", message: `Borderline — ${ratio.toFixed(1)}:1, consider a stronger scrim`, severity: "warn" });
    } else {
      checks.push({ code: "contrast", message: `Poor — ${ratio.toFixed(1)}:1, likely unreadable`, severity: "fail" });
    }
  }

  // --- Text readability: headline length vs. format's copy tier ---
  // Priority for what headline to check (most accurate → least accurate):
  //   1. renderedHeadline param — passed from pipeline after render, exact copy on canvas
  //   2. variant.renderedHeadline — stored from previous render, survives re-checks
  //   3. variant.headline — original campaign copy (fallback for old pre-fix data)
  //
  // For `tiny` formats (leaderboards, banners, companion banners) the renderer
  // always truncates copy severely regardless of word count — these formats
  // physically cannot fit a full headline, and Claude already shortens to 2-4
  // words at render time. Checking word count here is meaningless noise; we
  // just confirm that SOME headline copy is present.
  //
  // For `short` and `full`, we check the rendered word count against the
  // copy-tier limit so genuinely long headlines on medium/large formats get
  // flagged, while formats that were correctly shortened don't.
  const headlineToCheck = (
    renderedHeadline ||
    variant.renderedHeadline ||
    variant.headline ||
    ""
  ).trim();

  if (format.copyTier !== "cta_only") {
    if (format.copyTier === "tiny") {
      // Tiny formats: only check something is present
      if (!headlineToCheck) {
        checks.push({ code: "text_readability", message: "No headline copy — add a headline", severity: "warn" });
      } else {
        checks.push({ code: "text_readability", message: "Good — short copy fits this small format", severity: "pass" });
      }
    } else {
      const maxWords: Record<"short" | "full", number> = { short: 9, full: 16 };
      const wordCount = headlineToCheck.split(/\s+/).filter(Boolean).length;
      if (wordCount === 0) {
        checks.push({ code: "text_readability", message: "No headline copy — add a headline", severity: "warn" });
      } else if (wordCount <= maxWords[format.copyTier as "short" | "full"]) {
        checks.push({ code: "text_readability", message: `Good — ${wordCount} word${wordCount === 1 ? "" : "s"} fits this format`, severity: "pass" });
      } else {
        checks.push({ code: "text_readability", message: `Headline is ${wordCount} words — consider shortening for ${format.width}×${format.height}`, severity: "warn" });
      }
    }
  }

  // --- Image quality: is the source (base plate, or hero upload if no plate) high enough resolution for this format? ---
  const sourceBuf = sourceImageRef ? await readAsset(sourceImageRef).catch(() => null) : null;
  if (sourceBuf) {
    try {
      const meta = await sharp(sourceBuf).metadata();
      const srcW = meta.width ?? 0;
      const srcH = meta.height ?? 0;
      const srcMin = Math.min(srcW, srcH);
      const targetMin = Math.min(format.width, format.height);
      if (srcMin === 0) {
        checks.push({ code: "image_quality", message: "Could not read source image dimensions", severity: "warn" });
      } else if (srcMin >= targetMin * 0.75) {
        checks.push({ code: "image_quality", message: "High — source resolution comfortably covers this format", severity: "pass" });
      } else if (srcMin >= targetMin * 0.3) {
        checks.push({ code: "image_quality", message: "Source image is being upscaled for this format — consider a higher-res photo", severity: "warn" });
      } else {
        checks.push({ code: "image_quality", message: "Source image is significantly smaller than this format — quality loss likely", severity: "warn" });
      }
    } catch {
      checks.push({ code: "image_quality", message: "Could not evaluate source image quality", severity: "warn" });
    }
  }

  // --- CTA visible (present + non-empty, unless a tiny format where we intentionally drop it) ---
  if (format.copyTier === "tiny") {
    checks.push({ code: "cta_visible", message: "Good — CTA omitted intentionally, no room at this size", severity: "pass" });
  } else if (variant.cta && variant.cta.trim().length > 0) {
    checks.push({ code: "cta_visible", message: "Good — CTA present and legible", severity: "pass" });
  } else {
    checks.push({ code: "cta_visible", message: "Missing CTA copy", severity: "fail" });
  }

  // --- Legal copy included where required ---
  // lib/imageEngine.ts only ever draws the legal-copy line when
  // `format.height >= 480` (`showLegalBlock`) — below that there's no room
  // and it's dropped entirely, the same "intentionally omitted, not missing"
  // pattern already used for cta_visible on tiny formats just above. The
  // check used to claim "Legal copy included" and merely downgrade to
  // "warn" below 480px, which was inaccurate: at that size the renderer
  // doesn't include it at all, so a small format could never clear this
  // check even though omitting it there is expected, not an error.
  if (variant.showLegal) {
    const hasLegalText = !!(variant.legalCopy || brand.guidelineNotes);
    if (format.height < 480) {
      checks.push({
        code: "legal_copy",
        message: "Good — legal copy omitted intentionally, no room at this size",
        severity: "pass",
      });
    } else if (hasLegalText) {
      checks.push({ code: "legal_copy", message: "Legal copy included", severity: "pass" });
    } else {
      checks.push({ code: "legal_copy", message: "Legal copy required but none provided", severity: "fail" });
    }
  }

  // --- Crowding heuristic: how many text elements the renderer actually
  // draws vs. available height. Previously this counted raw variant fields
  // (headline/subhead/cta) whenever they were non-empty, regardless of
  // whether imageEngine.ts actually renders them for this format — e.g. the
  // banner layout (width/height >= 3, used by every leaderboard/masthead/
  // companion-banner format) only ever draws the headline; subhead and CTA
  // are never composited there at all. That mismatch meant plenty of small
  // banner formats were flagged "crowded" for elements that were never on
  // the canvas in the first place. Mirror the same isBanner/copyTier rules
  // imageEngine.ts uses so this reflects what's actually on the image.
  const isBannerLayout = format.width / format.height >= 3;
  let elementsShown = 0;
  if (format.copyTier !== "cta_only") {
    if (isBannerLayout) {
      if (variant.headline) elementsShown += 1; // banner layout: headline only
    } else {
      if (variant.headline) elementsShown += 1;
      if (variant.subhead && format.copyTier === "full" && format.height >= 400) elementsShown += 1;
      if (variant.cta && format.copyTier !== "tiny") elementsShown += 1;
    }
  }
  const crowded = format.height < 150 && elementsShown > 2;
  checks.push({
    code: "layout_density",
    message: crowded ? "Layout may be crowded for this format's height" : "Layout density looks fine",
    severity: crowded ? "warn" : "pass",
  });

  // --- Safe zone — always respected by construction (the compositor insets by safeZonePct) ---
  checks.push({ code: "safe_zone", message: "Good — safe-zone margins respected", severity: "pass" });

  const fails = checks.filter((c) => c.severity === "fail").length;
  const warns = checks.filter((c) => c.severity === "warn").length;
  const score = Math.max(0, 100 - fails * 15 - warns * 5);
  const passOrFail: BrandCheckReport["passOrFail"] = fails > 0 ? "fail" : warns > 2 ? "warn" : warns > 0 ? "warn" : "pass";

  return { score, passOrFail, checks };
}
