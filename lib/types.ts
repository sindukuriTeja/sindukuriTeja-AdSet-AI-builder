// Core data model — mirrors the product spec's object list:
// BrandKit, Campaign, AdFormat, CreativeVariant, BrandCheckReport

export type Platform =
  | "display"
  | "google_responsive"
  | "facebook"
  | "instagram"
  | "stories"
  | "tiktok"
  | "youtube";

export interface AdFormat {
  id: string; // e.g. "iab_mpu_300x250"
  name: string; // "Medium Rectangle / MPU"
  width: number;
  height: number;
  platform: Platform;
  group: string; // "Display / IAB", "Google Responsive Display", "Social"
  maxFileSizeKB?: number;
  safeZonePct?: number; // fraction of shortest side reserved as safe margin
  copyTier: "full" | "short" | "tiny" | "cta_only"; // how much copy this size can carry
  // "video" formats render as a short animated MP4 (pan/zoom on the base
  // plate + a fade-in of the same headline/subhead/CTA/logo layout) instead
  // of a static PNG — used for Stories & Reels, TikTok, and YouTube, since
  // those are video-first placements in practice. Defaults to "image".
  mediaType?: "image" | "video";
  videoDurationSec?: number; // only used when mediaType === "video"; default 5
}

export interface BrandColor {
  hex: string;
  role: "primary" | "secondary" | "accent" | "background" | "text";
}

export interface BrandKit {
  id: string;
  brandName: string;
  logoPath?: string; // public path to uploaded logo
  colors: BrandColor[];
  fonts: string[]; // font family names, e.g. ["Poppins", "Inter"]
  toneOfVoice?: string;
  ctaStyle?: string;
  clearSpacePx?: number;
  minLogoWidthPx?: number;
  guidelineNotes?: string; // free text extracted / pasted from brand guideline doc
}

export interface Campaign {
  id: string;
  campaignName: string;
  objective?: string;
  companyUrl?: string; // optional company website URL — fed to Claude for auto brand research
  researchSummary?: string; // what Claude found when it researched the company URL
  creativeDirection?: string; // Claude's visual brief — fed into Runway prompt for brand-matched backgrounds
  preferredStyles?: string[]; // poster styles Claude recommends for this brand
  brand: BrandKit;
  heroImagePath?: string; // uploaded product/hero image, public path
  headline: string;
  subhead?: string;
  cta: string;
  legalCopy?: string;
  selectedFormatIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type VariantStatus =
  | "pending"
  | "generating"
  | "ready"
  | "failed";

export interface CreativeVariant {
  id: string;
  campaignId: string;
  formatId: string;
  status: VariantStatus;
  error?: string; // last render error message, shown in the UI when status is "failed"
  imagePath?: string; // public path to rendered PNG
  basePlateUsed?: string; // which generated/source base plate this crop came from
  cropFocus?: { x: number; y: number }; // 0..1 normalized focal point used for crop
  headline: string;
  renderedHeadline?: string; // the headline Claude actually put on the image (may be shorter than headline)
  subhead?: string;
  cta: string;
  showLegal: boolean;
  legalCopy?: string;
  bgColor?: string;
  textColor?: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  locks: {
    crop: boolean;
    headline: boolean;
    logo: boolean;
  };
  version: number;
  brandCheck?: BrandCheckReport;
  updatedAt: string;
}

export interface BrandCheckIssue {
  code: string;
  message: string;
  severity: "pass" | "warn" | "fail";
}

export interface BrandCheckReport {
  score: number; // 0-100
  passOrFail: "pass" | "warn" | "fail";
  checks: BrandCheckIssue[];
}
