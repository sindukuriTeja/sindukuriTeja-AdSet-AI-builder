import { NextRequest, NextResponse } from "next/server";
import { researchCompany } from "@/lib/companyResearch";

// POST /api/research
// Body: { url: string }
// Returns: BrandIntelligence JSON or { error: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'url' field" }, { status: 400 });
    }

    // Normalise — allow bare domains like "apple.com"
    let url = body.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    const intel = await researchCompany(url);
    if (!intel) {
      return NextResponse.json(
        { error: "Research unavailable — ANTHROPIC_API_KEY not configured." },
        { status: 503 }
      );
    }

    return NextResponse.json({ intel });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("POST /api/research failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
