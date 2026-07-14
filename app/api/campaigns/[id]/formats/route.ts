import { NextRequest, NextResponse } from "next/server";
import { loadCampaign, saveCampaign, withCampaignLock } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  try {
    // Locked for the same reason as the campaign-info PATCH route — picking
    // formats and generating can happen back-to-back fast enough to race.
    const record = await withCampaignLock(id, async () => {
      const rec = await loadCampaign(id);
      if (!rec) return null;
      rec.campaign.selectedFormatIds = Array.isArray(body.formatIds)
        ? body.formatIds.filter((f: unknown) => typeof f === "string")
        : [];
      rec.campaign.updatedAt = new Date().toISOString();
      await saveCampaign(rec);
      return rec;
    });

    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(record);
  } catch (err) {
    console.error(`PATCH /api/campaigns/${id}/formats failed:`, err);
    return NextResponse.json({ error: "Update failed. Check server logs for details." }, { status: 500 });
  }
}
