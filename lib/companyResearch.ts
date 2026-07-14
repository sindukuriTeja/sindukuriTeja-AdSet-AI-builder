import Anthropic from "@anthropic-ai/sdk";

// Claude-powered company research.
//
// Given a public URL, Claude:
//  1. Fetches the page content via a tool call (web_search or its own browsing)
//  2. Analyses what it reads — industry, tone, visual identity signals, product USP
//  3. Returns a structured BrandIntelligence object that pre-fills the campaign form
//     AND drives richer, brand-specific Runway prompts downstream.
//
// If anything fails (bad URL, rate limit, no key) the function returns null and
// the caller falls back to the manual form — no disruption to the happy path.

export interface BrandIntelligence {
  brandName: string;
  industry: string;
  // Suggested copy
  headline: string;
  subhead: string;
  cta: string;
  toneOfVoice: string;
  // Visual identity derived from the site's palette / imagery
  primaryColor: string;   // hex
  secondaryColor: string; // hex
  accentColor: string;    // hex
  suggestedFonts: string; // comma-separated font names Claude infers from the brand feel
  // A rich creative brief Claude writes about the brand — fed straight into
  // the Runway prompt so the background scenes actually FEEL like this brand.
  creativeDirection: string;
  // Short mood/style notes that flow into guidelineNotes on the BrandKit
  guidelineNotes: string;
  // Which poster styles suit this brand (subset of the 10 styles in claude.ts)
  preferredStyles: string[];
  // The raw research summary — shown to the user as a "what Claude found" note
  researchSummary: string;
}

const CLAUDE_MODEL = "claude-opus-4-5";

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Anthropic({ apiKey: key, timeout: 60_000 });
  return _client;
}

// Fetch the raw HTML/text of a URL server-side (Next.js API route context).
// We truncate to ~12 000 chars so it fits comfortably in Claude's context
// alongside the rest of the prompt without wasting tokens on footer boilerplate.
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NapkinAdBot/1.0; brand research)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  // Strip tags and collapse whitespace to give Claude clean prose
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.slice(0, 12_000);
}

const SYSTEM_PROMPT = `You are a world-class brand strategist and advertising creative director.
You will be given the text content scraped from a company's website.
Study it carefully and return a single JSON object that describes the brand's creative identity.
Return ONLY the JSON — no markdown fences, no explanation, no extra text.

JSON schema:
{
  "brandName": "<company name>",
  "industry": "<one-line industry description>",
  "headline": "<compelling ad headline for this brand, 6-10 words>",
  "subhead": "<supporting subheadline, 8-14 words>",
  "cta": "<short action CTA, 2-4 words>",
  "toneOfVoice": "<e.g. bold and confident, warm and approachable, minimalist and precise>",
  "primaryColor": "<dominant brand hex color, e.g. #0057FF>",
  "secondaryColor": "<secondary/background hex>",
  "accentColor": "<accent/highlight hex>",
  "suggestedFonts": "<comma-separated font names that fit this brand>",
  "creativeDirection": "<2-3 sentences: describe the visual world this brand lives in — lighting, textures, mood, imagery style — written as a Midjourney/Stable Diffusion style prompt that Runway can use to generate matching backgrounds>",
  "guidelineNotes": "<2-3 sentences of brand do's and don'ts inferred from the site>",
  "preferredStyles": ["<one or more of: bold_type, editorial, minimal_clean, vibrant_gradient, split_panel, centered_hero, top_banner, full_bleed_scrim, neon_accent, typographic_grid>"],
  "researchSummary": "<2-3 sentences summarising what you found and the creative choices you made>"
}

Be decisive — always pick real hex values and specific font names. Never say "unknown" or leave a field empty.`;

export async function researchCompany(url: string): Promise<BrandIntelligence | null> {
  const claude = getClient();
  if (!claude) {
    console.warn("[companyResearch] No ANTHROPIC_API_KEY — skipping research");
    return null;
  }

  let pageText: string;
  try {
    pageText = await fetchPageText(url);
  } catch (err) {
    console.error("[companyResearch] Failed to fetch URL:", err);
    throw new Error(`Could not fetch "${url}". Make sure it's a public URL and try again.`);
  }

  const userMessage = `Company URL: ${url}

Scraped page content:
---
${pageText}
---

Analyse this brand deeply and return the JSON creative brief.`;

  try {
    const response = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");

    // Extract JSON even if Claude accidentally adds surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in Claude response");

    const intel = JSON.parse(match[0]) as BrandIntelligence;

    // Validate required fields
    if (!intel.brandName || !intel.headline || !intel.primaryColor) {
      throw new Error("Incomplete brand intelligence response");
    }

    // Sanitize hex — Claude sometimes returns shorthand like #fff
    intel.primaryColor = normalizeHex(intel.primaryColor, "#6d4aff");
    intel.secondaryColor = normalizeHex(intel.secondaryColor, "#ffffff");
    intel.accentColor = normalizeHex(intel.accentColor, "#f0f0f0");

    console.log(`[companyResearch] ✓ ${intel.brandName} — ${intel.industry}`);
    return intel;
  } catch (err) {
    console.error("[companyResearch] Claude parsing error:", err);
    throw new Error("Claude could not analyse this site. Try a different URL or fill in the form manually.");
  }
}

function normalizeHex(value: string, fallback: string): string {
  if (!value || typeof value !== "string") return fallback;
  const v = value.trim();
  // Expand shorthand #abc → #aabbcc
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  return fallback;
}
