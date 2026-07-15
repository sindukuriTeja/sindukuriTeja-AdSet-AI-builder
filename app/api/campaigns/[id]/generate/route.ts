import { NextRequest, NextResponse } from "next/server";
import { generateForFormats } from "@/lib/pipeline";
import { loadCampaign } from "@/lib/db";

// Keep timeout at 60s — Vercel Hobby plan maximum.
// The client sends formats in small batches so no single request exceeds this.
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadCampaign(id);
  if (!record) {
    console.error(`[generate] Campaign ${id} not found in storage.`);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const formatIds: string[] = body.formatIds?.length ? body.formatIds : record.campaign.selectedFormatIds;
  const force = !!body.force;

  if (!formatIds.length) {
    return NextResponse.json({ error: "No formats selected" }, { status: 400 });
  }
  if (!record.campaign.heroImagePath) {
    return NextResponse.json({ error: "Upload a hero image first" }, { status: 400 });
  }

  try {
    const updated = await generateForFormats(id, formatIds, { force });
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`Generate route failed for campaign ${id}:`, err);
    return NextResponse.json({ error: "Generation failed. Check server logs for details." }, { status: 500 });
  }
}
