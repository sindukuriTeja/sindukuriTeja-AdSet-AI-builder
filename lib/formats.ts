import { AdFormat, Platform } from "./types";

// Full catalog pulled directly from the format list in the product brief,
// grouped into the six platform tiles shown on the "Choose Platforms &
// Formats" screen (Web & Display, Facebook, Instagram, Stories & Reels,
// TikTok, YouTube). Google's responsive-display assets are folded into
// "Web & Display" since they're web placements, not a social surface —
// every format from the spec is still represented, just regrouped visually.

function fmt(
  id: string,
  name: string,
  width: number,
  height: number,
  platform: Platform,
  group: string,
  copyTier: AdFormat["copyTier"],
  opts: { safeZonePct?: number; maxFileSizeKB?: number; mediaType?: AdFormat["mediaType"]; videoDurationSec?: number } = {}
): AdFormat {
  return {
    id,
    name,
    width,
    height,
    platform,
    group,
    copyTier,
    safeZonePct: opts.safeZonePct ?? 0.08,
    maxFileSizeKB: opts.maxFileSizeKB ?? 150,
    mediaType: opts.mediaType ?? "image",
    videoDurationSec: opts.videoDurationSec,
  };
}

// Stories & Reels, TikTok, and YouTube are video-first placements in
// practice, so every format in those three groups renders as a short
// animated MP4 (see lib/videoEngine.ts) instead of a static PNG — a
// pan/zoom over the same base plate used for images, with the same
// headline/subhead/CTA/logo layout fading in, reusing lib/imageEngine.ts's
// overlay builder so the two renderers never drift out of sync visually.
const VIDEO: { mediaType: AdFormat["mediaType"] } = { mediaType: "video" };

const WEB = "Web & Display";
const FB = "Facebook";
const IG = "Instagram";
const STORIES = "Stories & Reels";
const TIKTOK = "TikTok";
const YT = "YouTube";

export const AD_FORMATS: AdFormat[] = [
  // --- Web & Display: IAB display + Google responsive display assets ---
  fmt("iab_mpu_300x250", "Medium Rectangle / MPU", 300, 250, "display", WEB, "short"),
  fmt("iab_lrec_336x280", "Large Rectangle", 336, 280, "display", WEB, "short"),
  fmt("iab_leaderboard_728x90", "Leaderboard", 728, 90, "display", WEB, "tiny"),
  fmt("iab_superlb_970x90", "Super Leaderboard", 970, 90, "display", WEB, "tiny"),
  fmt("iab_billboard_970x250", "Billboard", 970, 250, "display", WEB, "full"),
  fmt("iab_skyscraper_160x600", "Wide Skyscraper", 160, 600, "display", WEB, "full"),
  fmt("iab_halfpage_300x600", "Half Page", 300, 600, "display", WEB, "full"),
  fmt("iab_mobile_lb_320x50", "Mobile Leaderboard", 320, 50, "display", WEB, "tiny"),
  fmt("iab_mobile_banner_300x50", "Mobile Banner", 300, 50, "display", WEB, "tiny"),
  fmt("iab_mobile_lg_320x100", "Large Mobile Banner", 320, 100, "display", WEB, "short"),
  fmt("iab_interstitial_640x1136", "Mobile Interstitial", 640, 1136, "display", WEB, "full"),
  fmt("iab_interstitial_1080x1920", "Mobile Interstitial (Story-style)", 1080, 1920, "display", WEB, "full"),
  fmt("google_landscape_1200x628", "Google Responsive — Landscape", 1200, 628, "google_responsive", WEB, "short"),
  fmt("google_square_1200x1200", "Google Responsive — Square", 1200, 1200, "google_responsive", WEB, "full"),
  fmt("google_vertical_900x1600", "Google Responsive — Vertical", 900, 1600, "google_responsive", WEB, "full"),
  fmt("google_logo_square_1200x1200", "Google Logo — Square", 1200, 1200, "google_responsive", WEB, "cta_only"),
  fmt("google_logo_landscape_1200x300", "Google Logo — Landscape", 1200, 300, "google_responsive", WEB, "cta_only"),

  // --- Facebook ---
  fmt("facebook_feed_1200x628", "Feed Image", 1200, 628, "facebook", FB, "short"),
  fmt("facebook_square_1080x1080", "Feed Square", 1080, 1080, "facebook", FB, "full", { safeZonePct: 0.1 }),
  fmt("facebook_portrait_1080x1350", "Feed Portrait", 1080, 1350, "facebook", FB, "full", { safeZonePct: 0.1 }),
  fmt("facebook_stories_1080x1920", "Facebook Stories", 1080, 1920, "facebook", FB, "full", { safeZonePct: 0.1 }),
  fmt("facebook_right_column_254x133", "Right Column", 254, 133, "facebook", FB, "tiny"),
  fmt("facebook_carousel_1080x1080", "Carousel Card", 1080, 1080, "facebook", FB, "short", { safeZonePct: 0.1 }),

  // --- Instagram ---
  fmt("instagram_feed_1080x1080", "Feed Square", 1080, 1080, "instagram", IG, "full", { safeZonePct: 0.1 }),
  fmt("instagram_portrait_1080x1350", "Feed Portrait", 1080, 1350, "instagram", IG, "full", { safeZonePct: 0.1 }),
  fmt("instagram_stories_1080x1920", "Instagram Stories", 1080, 1920, "instagram", IG, "full", { safeZonePct: 0.1 }),
  fmt("instagram_reels_1080x1920", "Reels Cover", 1080, 1920, "instagram", IG, "full", { safeZonePct: 0.1 }),
  fmt("instagram_landscape_1200x628", "Landscape", 1200, 628, "instagram", IG, "short"),

  // --- Stories & Reels (cross-platform vertical placements) — video ---
  fmt("stories_1080x1920", "Story / Reels", 1080, 1920, "stories", STORIES, "full", { safeZonePct: 0.1, ...VIDEO }),
  fmt("stories_hi_1440x2560", "High-res Story", 1440, 2560, "stories", STORIES, "full", { safeZonePct: 0.1, ...VIDEO }),
  fmt("stories_portrait_1200x1500", "Portrait", 1200, 1500, "stories", STORIES, "full", { ...VIDEO }),

  // --- TikTok — video ---
  fmt("tiktok_infeed_1080x1920", "In-Feed Video Cover", 1080, 1920, "tiktok", TIKTOK, "full", { safeZonePct: 0.12, ...VIDEO }),
  fmt("tiktok_square_1080x1080", "Square", 1080, 1080, "tiktok", TIKTOK, "full", { safeZonePct: 0.1, ...VIDEO }),
  fmt("tiktok_landscape_1280x720", "Landscape", 1280, 720, "tiktok", TIKTOK, "short", { ...VIDEO }),

  // --- YouTube — video. "Bumper" is genuinely a 6s video ad in YouTube's
  // own spec, so it gets a slightly longer duration; everything else in
  // this group defaults to 5s (see lib/videoEngine.ts). ---
  fmt("youtube_discovery_1280x720", "Discovery Thumbnail", 1280, 720, "youtube", YT, "short", { ...VIDEO }),
  fmt("youtube_display_300x250", "Display Banner", 300, 250, "youtube", YT, "short", { ...VIDEO }),
  fmt("youtube_companion_300x60", "Companion Banner", 300, 60, "youtube", YT, "tiny", { ...VIDEO }),
  fmt("youtube_masthead_970x250", "Masthead", 970, 250, "youtube", YT, "full", { ...VIDEO }),
  fmt("youtube_bumper_640x360", "Bumper Thumbnail", 640, 360, "youtube", YT, "short", { ...VIDEO, videoDurationSec: 6 }),
];

export const PLATFORM_GROUPS = [WEB, FB, IG, STORIES, TIKTOK, YT];

export function getFormat(id: string): AdFormat | undefined {
  return AD_FORMATS.find((f) => f.id === id);
}

export function groupedFormats(): Record<string, AdFormat[]> {
  const grouped = AD_FORMATS.reduce((acc, f) => {
    (acc[f.group] ||= []).push(f);
    return acc;
  }, {} as Record<string, AdFormat[]>);
  // Preserve the platform-tile display order rather than first-seen order.
  return PLATFORM_GROUPS.reduce((ordered, g) => {
    if (grouped[g]) ordered[g] = grouped[g];
    return ordered;
  }, {} as Record<string, AdFormat[]>);
}

// Buckets used to pick which generated "base plate" aspect ratio to crop from.
export type PlateBucket = "square" | "landscape_wide" | "landscape_ultrawide" | "portrait" | "portrait_tall";

export function bucketFor(f: AdFormat): PlateBucket {
  const ratio = f.width / f.height;
  if (ratio >= 3.5) return "landscape_ultrawide"; // leaderboards / banners
  if (ratio >= 1.35) return "landscape_wide"; // billboard, google landscape
  if (ratio >= 0.85) return "square";
  if (ratio >= 0.55) return "portrait";
  return "portrait_tall"; // skyscraper, stories, interstitials
}
