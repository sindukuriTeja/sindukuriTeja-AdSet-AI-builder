import { NextRequest, NextResponse } from "next/server";
import { loadCampaign, updateVariant } from "@/lib/db";
import { generateForFormats } from "@/lib/pipeline";
import { isHex } from "@/lib/colors";

// A single video re-render can take a while (ffmpeg encode + a Runway call
// if plates need regenerating) — see the comment in generate/route.ts.
export const maxDuration = 120;

const LOGO_POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right", "center"]);

// Quick edits to a single creative: headline override, CTA, background
// colour, logo position, legal-copy toggle, and lock flags. Re-renders just
// that one format through the compositor (no new Runway call needed).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  const { id, variantId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const record = await loadCampaign(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const variant = record.variants.find((v) => v.id === variantId);
  if (!variant) return NextResponse.json({ error: "Variant not found" }, { status: 404 });

  // Same blank-string gap as the campaign-info route: a whitespace-only
  // headline/CTA is truthy in JS, so `!== undefined` alone let it through
  // and rendered as invisible blank text with no error.
  if (typeof body.headline === "string" && body.headline.trim()) variant.headline = body.headline.trim();
  if (typeof body.cta === "string" && body.cta.trim()) variant.cta = body.cta.trim();
  if (body.bgColor !== undefined) {
    if (!isHex(body.bgColor)) return NextResponse.json({ error: `"${body.bgColor}" isn't a valid hex color` }, { status: 400 });
    variant.bgColor = body.bgColor;
  }
  if (body.logoPosition !== undefined) {
    if (!LOGO_POSITIONS.has(body.logoPosition)) {
      return NextResponse.json({ error: `"${body.logoPosition}" isn't a valid logo position` }, { status: 400 });
    }
    variant.logoPosition = body.logoPosition;
  }
  if (body.showLegal !== undefined) variant.showLegal = !!body.showLegal;
  if (body.locks !== undefined) variant.locks = { ...variant.locks, ...body.locks };
  variant.updatedAt = new Date().toISOString();

  try {
    await updateVariant(id, variant);

    if (body.rerender !== false) {
      const updated = await generateForFormats(id, [variant.formatId], { force: true });
      return NextResponse.json(updated);
    }

    return NextResponse.json(await loadCampaign(id));
  } catch (err) {
    console.error(`PATCH /api/campaigns/${id}/variants/${variantId} failed:`, err);
    return NextResponse.json({ error: "Update failed. Check server logs for details." }, { status: 500 });
  }
}
