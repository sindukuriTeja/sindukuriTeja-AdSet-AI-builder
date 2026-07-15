import Anthropic from "@anthropic-ai/sdk";
import { AdFormat, BrandKit } from "./types";
import { contrastRatio, bestTextColor, isHex } from "./colors";

// ─── Poster styles ──────────────────────────────────────────────────────────
export type PosterStyle =
  | "right_panel_hero"    // THE Red Bull style: full photo, headline right-aligned upper-right, logo below
  | "full_bleed_scrim"    // Full-bleed photo, gradient scrim bottom-half, copy centre-bottom
  | "editorial"           // Near-opaque dark overlay, oversized headline, magazine energy
  | "top_text_bar"        // Solid brand-colour strip at top, headline inside, photo below
  | "split_left_text"     // Solid brand panel left 45%, large type inside, action photo right
  | "bottom_text_block"   // Solid brand block at bottom 38%, oversized white bold headline
  | "minimal_overlay"     // Very light bottom scrim only, minimal copy, scene breathes
  | "neon_accent"         // Dark cinematic scene, electric neon accent on headline
  | "bold_centered";      // Oversized headline centred on photo, radial scrim

const STYLE_DESCRIPTIONS: Record<PosterStyle, string> = {
  right_panel_hero:   "PREFERRED: Full photo, headline RIGHT-ALIGNED upper-right in massive bold white type (stacked), logo right-aligned below headline. Subtle dark vignette only at corners. This is the Red Bull / Nike style.",
  full_bleed_scrim:   "Full cinematic photo, gradient scrim from mid to bottom, copy centre-bottom",
  editorial:          "Near-opaque dark overlay whole image, large bold type, magazine cover energy",
  top_text_bar:       "Solid brand-colour strip at top 20%, headline + logo inside, full photo below",
  split_left_text:    "Solid brand-colour panel left 45%, large type inside, action photo right",
  bottom_text_block:  "Solid brand block at bottom 38%, oversized white bold headline inside",
  minimal_overlay:    "Very light bottom scrim only, minimal copy, scene breathes",
  neon_accent:        "Dark cinematic scene, electric neon colour on headline, glow effect",
  bold_centered:      "Oversized bold headline centred on photo, radial scrim",
};

// ─── Creative concept ───────────────────────────────────────────────────────
export interface CreativeConcept {
  style: PosterStyle;
  headline: string;
  subhead: string;
  cta: string;
  bgColor: string;       // dominant colour tone of the scene (used for scrim/overlay)
  accentColor: string;   // accent / CTA colour
  textColor: string;     // main copy colour — must contrast 4.5:1 with bgColor
  overlayOpacity: number;
  conceptNote: string;
  /**
   * Complete Runway image-generation prompt.
   * This describes the FULL scene including the product naturally placed
   * within it — athlete, action, environment, lighting, AND the product.
   * Runway renders this as one complete photorealistic advertising image.
   * Text/logo will be composited on top by the render engine, so this
   * prompt must NOT include any text, headlines or logos.
   */
  scenePrompt: string;
  /** Short kebab tag identifying this scene, e.g. rooftop-parkour-dusk */
  sceneTag: string;
}

// ─── Claude client ──────────────────────────────────────────────────────────
let _client: Anthropic | null = null;
let _clientBroken = false;
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";

function getClient(): Anthropic | null {
  if (_clientBroken) return null;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Anthropic({ apiKey: key, timeout: 45_000 });
  return _client;
}

function enforceContrast(textColor: string, bgColor: string): string {
  if (!isHex(textColor) || !isHex(bgColor)) return bestTextColor(bgColor);
  if (contrastRatio(textColor, bgColor) >= 4.5) return textColor;
  return bestTextColor(bgColor);
}

// ─── Fallback scenes (when Claude is unavailable) ───────────────────────────
const FALLBACK_SCENES = [
  {
    prompt: "Extreme athlete mid-air parkour leap off the edge of a rooftop, arms spread wide, golden-hour São Paulo skyline glowing behind. In the foreground on the concrete ledge, the product can standing upright, condensation on its surface catching the warm backlight. Shot from a low angle looking up, 50mm lens, cinematic colour grade, dramatic rim lighting.",
    tag: "rooftop-parkour-dusk",
  },
  {
    prompt: "Mountain biker carving a steep rocky alpine trail at speed, dust cloud exploding behind the rear tyre, snow-capped peaks and a glacial lake reflecting clouds below. The product can is wedged into the rocks at the bottom-left foreground, sharp and in focus. Wide-angle lens, bright alpine sky, ultra-sharp detail.",
    tag: "alpine-mtb-noon",
  },
  {
    prompt: "Surfer dropping into a massive translucent green barrel wave at dawn, golden spray catching first light, deep ocean blue through the wave face. The product can stands on the wet sand in the foreground, sun glinting off the logo. Shot from inside the barrel looking out, cinematic.",
    tag: "barrel-surf-dawn",
  },
  {
    prompt: "Rock climber reaching for a crimper on a sheer sandstone cliff at sunset, chalk dust floating, vast canyon valley spreading far below bathed in amber light. The product can sits on a small rocky ledge in the lower-right corner, perfectly still against the motion. Vertical composition, tight telephoto.",
    tag: "cliff-climb-sunset",
  },
  {
    prompt: "BMX rider launching off a massive concrete quarter-pipe in an urban plaza at blue hour, bike inverted in the air, neon city lights reflecting on the wet ground below. The product can stands on the lip of the ramp in the foreground, dramatic upward angle, motion blur on the rider.",
    tag: "bmx-plaza-bluehour",
  },
];

function fallbackConcept(
  formatId: string,
  headline: string,
  subhead: string | undefined,
  cta: string,
  brand: BrandKit,
  sceneIndex = 0,
): CreativeConcept {
  const styles: PosterStyle[] = [
    "right_panel_hero", "right_panel_hero", "right_panel_hero", // weighted heavily
    "full_bleed_scrim", "editorial", "top_text_bar", "split_left_text",
    "bottom_text_block", "minimal_overlay", "neon_accent", "bold_centered",
  ];
  const hash = formatId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const style = styles[hash % styles.length];
  const primary = brand.colors.find((c) => c.role === "primary")?.hex || "#c8102e";
  const secondary = brand.colors.find((c) => c.role === "secondary")?.hex || "#ffffff";
  const bgColor = "#0d0d12";
  const scene = FALLBACK_SCENES[sceneIndex % FALLBACK_SCENES.length];
  return {
    style,
    headline,
    subhead: subhead || "",
    cta,
    bgColor,
    accentColor: primary,
    textColor: "#ffffff",
    overlayOpacity: 0.0,
    conceptNote: `Fallback style: ${style}`,
    scenePrompt: scene.prompt,
    sceneTag: scene.tag,
  };
}

// ─── Per-format creative director call ──────────────────────────────────────
export async function getCreativeConcept(
  format: AdFormat,
  brand: BrandKit,
  headline: string,
  subhead: string | undefined,
  cta: string,
  heroBuf?: Buffer,
  campaignObjective?: string,
  preferredStyles?: string[],
  formatIndex = 0,
): Promise<CreativeConcept> {
  if (format.copyTier === "cta_only") {
    return fallbackConcept(format.id, headline, subhead, cta, brand, formatIndex);
  }
  const claude = getClient();
  if (!claude) {
    return fallbackConcept(format.id, headline, subhead, cta, brand, formatIndex);
  }

  const primaryHex = brand.colors.find((c) => c.role === "primary")?.hex || "#c8102e";
  const styleList = Object.entries(STYLE_DESCRIPTIONS)
    .map(([k, v]) => `  - "${k}": ${v}`)
    .join("\n");
  const styleHint = preferredStyles?.length
    ? `\nPREFERRED STYLES for this brand (strongly prefer one of these): ${preferredStyles.join(", ")}`
    : "";

  const systemPrompt = `You are the lead creative director on a world-class advertising campaign — think Red Bull, Nike, Apple. Your job is to design ONE complete, unique, high-impact poster concept for a specific ad format.

WHAT YOU ARE DESIGNING:
The output from this system is:
1. A Runway AI-generated photorealistic scene (background + product in scene)
2. Text + logo overlaid on top by the renderer

Your job is to write the Runway scene prompt AND the layout/copy decisions.

─── THE RUNWAY SCENE PROMPT ───────────────────────────────────────────────────
Write a complete, detailed cinematic photography prompt that:
• Describes a unique, high-action or lifestyle scene fitting this brand
• Includes the PRODUCT naturally placed in the scene (on a surface, held, in foreground)
• Specifies: the action/subject, exact environment, time of day, lighting, camera angle, lens
• Is 80-120 words — detailed enough that Runway produces a ready-to-use advertising photo
• Is DIFFERENT from any generic campaign scene — be bold, specific, cinematic
• Must NOT include any text, words, headlines, logos, or UI elements

Example of a GREAT scene prompt:
"Extreme athlete executes a perfect backflip off a sea cliff at the Azores at golden hour, ocean spray catching the last rays of light, turquoise water far below. In the immediate foreground on a flat basalt rock, the energy drink can stands upright, condensation glistening, the brand design in sharp focus. Shot from a low angle, 24mm wide-angle, cinematic teal-orange grade, dramatic natural rim lighting on both the athlete and the can."

─── LAYOUT STYLES ─────────────────────────────────────────────────────────────
${styleList}${styleHint}

─── RULES ─────────────────────────────────────────────────────────────────────
- For square (1:1) and portrait formats: STRONGLY prefer "right_panel_hero" — it matches the Red Bull reference style exactly
- For landscape/wide formats: use "full_bleed_scrim", "top_text_bar", or "split_left_text"
- textColor MUST contrast 4.5:1+ against bgColor — use #ffffff on dark/photo backgrounds
- overlayOpacity: 0.0 for right_panel_hero (no overlay on the photo), 0.50-0.75 for others
- Adapt headline length: tiny ≤ 4 words, short ≤ 8 words, full ≤ 14 words
- UNIQUENESS: This is concept #${formatIndex + 1}. The scene MUST be completely different from other formats
- bgColor for right_panel_hero: use a dark near-black matching the scene's shadow tone (e.g. "#0d0d10")

Return ONLY valid JSON, no markdown:
{
  "style": "<style key>",
  "headline": "<adapted headline>",
  "subhead": "<subhead or empty string>",
  "cta": "<cta text>",
  "bgColor": "<#hex>",
  "accentColor": "<#hex>",
  "textColor": "<#hex>",
  "overlayOpacity": <number 0.0-0.85>,
  "conceptNote": "<one sentence: scene + why it works for this format>",
  "scenePrompt": "<complete Runway prompt, 80-120 words, full scene including product placement>",
  "sceneTag": "<unique-scene-kebab-tag>"
}`;

  const userContent: Anthropic.MessageParam["content"] = [];
  if (heroBuf) {
    try {
      const sharp = (await import("sharp")).default;
      const resized = await sharp(heroBuf)
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: resized.toString("base64") },
      });
    } catch { /* vision optional */ }
  }

  userContent.push({
    type: "text",
    text: `Brand: ${brand.brandName}
Product: (see attached image above — use this exact product in the scene)
Objective: ${campaignObjective || "Drive brand awareness and emotional connection"}
Format: ${format.name} (${format.width}×${format.height}px, copy tier: ${format.copyTier}, platform: ${format.platform})
Primary colour: ${primaryHex}
Headline: "${headline}"
Subhead: "${subhead || ""}"
CTA: "${cta}"
Brand tone: ${brand.guidelineNotes || "Bold, high-energy, authentic — real athletes doing extraordinary things. Show the product as an enabler of peak human performance."}

Design concept #${formatIndex + 1} — make the scene completely unique to this format and platform.`,
  });

  try {
    const response = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");
    // Extract JSON even if Claude adds surrounding commentary
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Claude response");
    const parsed = JSON.parse(jsonMatch[0]) as CreativeConcept;
    if (!parsed.style || !parsed.headline || !parsed.bgColor || !parsed.scenePrompt) {
      throw new Error("Incomplete concept — missing required fields");
    }
    parsed.textColor = enforceContrast(parsed.textColor, parsed.bgColor);
    if (!isHex(parsed.accentColor)) parsed.accentColor = primaryHex;
    console.log(`[claude] ✓ #${formatIndex + 1} ${format.id} → style:${parsed.style} scene:"${parsed.sceneTag}" copy:"${parsed.headline}"`);
    return parsed;
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes("401") || msg.includes("403") || msg.includes("invalid_api_key")) {
      _clientBroken = true;
      console.warn("[claude] Auth error — falling back for all remaining formats.");
    } else {
      console.error(`[claude] ${format.id} error: ${msg.slice(0, 150)}`);
    }
    return fallbackConcept(format.id, headline, subhead, cta, brand, formatIndex);
  }
}

// ─── Batch concept generation ───────────────────────────────────────────────
export async function generateConceptsForFormats(
  formats: AdFormat[],
  brand: BrandKit,
  headline: string,
  subhead: string | undefined,
  cta: string,
  heroBuf?: Buffer,
  campaignObjective?: string,
  concurrency = 5,
  preferredStyles?: string[],
): Promise<Map<string, CreativeConcept>> {
  const results = new Map<string, CreativeConcept>();
  for (let i = 0; i < formats.length; i += concurrency) {
    const chunk = formats.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map((f, j) =>
        getCreativeConcept(
          f, brand, headline, subhead, cta,
          heroBuf, campaignObjective, preferredStyles,
          i + j,
        ).then((c) => [f.id, c] as [string, CreativeConcept])
      ),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") results.set(r.value[0], r.value[1]);
    }
  }
  return results;
}

// ─── Brand research ──────────────────────────────────────────────────────────
export async function researchBrand(
  companyUrl: string,
  brandName: string,
): Promise<{ summary: string; creativeDirection: string; preferredStyles: string[] } | null> {
  const claude = getClient();
  if (!claude) return null;
  try {
    const response = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `You are a brand strategist. Based on what you know about "${brandName}" (${companyUrl}), provide:
1. A 2-3 sentence brand summary
2. A visual creative direction brief (lighting, colour palette mood, photography style, imagery themes)
3. The 3 best poster styles for this brand from: full_bleed_scrim, editorial, top_text_bar, split_left_text, bottom_text_block, minimal_overlay, neon_accent, bold_centered

Return ONLY JSON:
{"summary":"...","creativeDirection":"...","preferredStyles":["...","...","..."]}`,
      }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    if (!p.summary || !p.creativeDirection) return null;
    return { summary: p.summary, creativeDirection: p.creativeDirection, preferredStyles: Array.isArray(p.preferredStyles) ? p.preferredStyles : [] };
  } catch (err) {
    console.error("[claude] researchBrand failed:", (err as Error).message);
    return null;
  }
}
