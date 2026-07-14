import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { listCampaigns, saveCampaign } from "@/lib/db";
import { Campaign } from "@/lib/types";
import { isHex } from "@/lib/colors";

const DEFAULT_PRIMARY = "#6d4aff";

// A non-hex primary/secondary color used to slip straight into the brand
// kit; lib/colors.ts's hexToRgb() doesn't validate its input, so garbage in
// here didn't error anywhere — it just produced NaN math and silently broke
// contrast/text-color decisions on every rendered ad for that campaign.
function safeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && isHex(value) ? value : fallback;
}

export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (err) {
    console.error("GET /api/campaigns failed:", err);
    return NextResponse.json({ campaigns: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date().toISOString();
    const id = uuidv4();

    const campaign: Campaign = {
      id,
      campaignName: body.campaignName || "Untitled Campaign",
      objective: body.objective,
      companyUrl: body.companyUrl || undefined,
      researchSummary: body.researchSummary || undefined,
      creativeDirection: body.creativeDirection || undefined,
      preferredStyles: Array.isArray(body.preferredStyles) ? body.preferredStyles : undefined,
      brand: {
        id: uuidv4(),
        brandName: body.brandName || "Brand",
        colors: [
          { hex: safeHex(body.primaryColor, DEFAULT_PRIMARY), role: "primary" },
          ...(body.secondaryColor && isHex(body.secondaryColor)
            ? [{ hex: body.secondaryColor as string, role: "secondary" as const }]
            : []),
        ],
        fonts: body.fonts ? String(body.fonts).split(",").map((s: string) => s.trim()).filter(Boolean) : [],
        toneOfVoice: body.toneOfVoice,
        ctaStyle: body.ctaStyle,
        guidelineNotes: body.guidelineNotes,
      },
      // .trim() as well as the usual falsy check — a whitespace-only string
      // is truthy in JS, so " " used to sail past `|| "fallback"` and render
      // as invisible blank space on every generated ad with no error anywhere.
      headline: typeof body.headline === "string" && body.headline.trim() ? body.headline.trim() : "Your Headline Here",
      subhead: body.subhead,
      cta: typeof body.cta === "string" && body.cta.trim() ? body.cta.trim() : "Shop Now",
      legalCopy: body.legalCopy,
      selectedFormatIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await saveCampaign({ campaign, variants: [] });
    return NextResponse.json({ campaign });
  } catch (err) {
    console.error("POST /api/campaigns failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
