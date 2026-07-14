import { NextRequest, NextResponse } from "next/server";
import { loadCampaign, saveCampaign, withCampaignLock } from "@/lib/db";
import { isHex } from "@/lib/colors";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadCampaign(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

// A blank/whitespace headline used to slip through here (`body.headline ??
// campaign.headline` only guards against the field being absent, not an
// empty string someone actually submitted) and render as silent blank
// space on every format — no error anywhere, just an ad with no headline.
// Trimming and falling back to the existing value catches that case.
function cleanText(next: unknown, fallback: string): string {
  if (typeof next !== "string") return fallback;
  const trimmed = next.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  try {
    // Wrapped in the same per-campaign lock updateVariant() uses — this
    // route does the same unlocked read/mutate/save pattern that let a
    // concurrent "Generate all" and a campaign-info edit silently clobber
    // each other's writes.
    const record = await withCampaignLock(id, async () => {
      const rec = await loadCampaign(id);
      if (!rec) return null;
      const { campaign } = rec;

      Object.assign(campaign, {
        campaignName: cleanText(body.campaignName, campaign.campaignName),
        objective: body.objective ?? campaign.objective,
        headline: cleanText(body.headline, campaign.headline),
        subhead: body.subhead ?? campaign.subhead,
        cta: cleanText(body.cta, campaign.cta),
        legalCopy: body.legalCopy ?? campaign.legalCopy,
        updatedAt: new Date().toISOString(),
      });

      // Garbage hex input (typo, non-color string, etc.) used to be written
      // straight through — lib/colors.ts's hexToRgb() then silently returns
      // NaN math on it instead of throwing, which quietly broke contrast and
      // text-color decisions everywhere downstream. Only accept it if it's
      // actually a valid hex color; otherwise keep whatever was there before.
      if (body.primaryColor !== undefined) {
        if (isHex(body.primaryColor)) {
          const primary = campaign.brand.colors.find((c) => c.role === "primary");
          if (primary) primary.hex = body.primaryColor;
        } else {
          return { error: `"${body.primaryColor}" isn't a valid hex color` } as const;
        }
      }
      if (body.brandName) campaign.brand.brandName = cleanText(body.brandName, campaign.brand.brandName);
      if (body.guidelineNotes !== undefined) campaign.brand.guidelineNotes = body.guidelineNotes;

      await saveCampaign(rec);
      return rec;
    });

    if (record === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ("error" in record) return NextResponse.json(record, { status: 400 });
    return NextResponse.json(record);
  } catch (err) {
    console.error(`PATCH /api/campaigns/${id} failed:`, err);
    return NextResponse.json({ error: "Update failed. Check server logs for details." }, { status: 500 });
  }
}
