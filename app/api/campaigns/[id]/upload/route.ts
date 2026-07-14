import { NextRequest, NextResponse } from "next/server";
import { loadCampaign, saveCampaign } from "@/lib/db";
import { saveAsset } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// Previously any file was accepted here — a non-image upload (a PDF, a
// renamed .zip, an empty file) would sail through this route with a 200 and
// only fail later, deep inside sharp() during generation, as an opaque
// "Regenerate" failure disconnected from the upload that actually caused
// it. Checking the extension and a sane size cap at the point of upload
// gives an immediate, specific error instead.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — generous for a product/logo photo

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const record = await loadCampaign(id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData();

    async function saveField(field: string, baseName: string): Promise<string | { error: string }| undefined> {
      const file = form.get(field);
      if (!(file instanceof File)) return undefined;

      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (!CONTENT_TYPES[ext]) {
        return { error: `${field}: "${file.name}" isn't a supported image type (use PNG, JPG, WEBP, or GIF)` };
      }
      if (file.size === 0) {
        return { error: `${field}: "${file.name}" is empty` };
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return { error: `${field}: "${file.name}" is over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` };
      }

      const buf = Buffer.from(await file.arrayBuffer());
      return saveAsset(buf, `uploads/${id}/${baseName}.${ext}`, CONTENT_TYPES[ext]);
    }

    const [heroResult, logoResult] = await Promise.all([saveField("hero", "hero"), saveField("logo", "logo")]);

    for (const result of [heroResult, logoResult]) {
      if (result && typeof result === "object" && "error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
    }

    if (typeof heroResult === "string") record.campaign.heroImagePath = heroResult;
    if (typeof logoResult === "string") record.campaign.brand.logoPath = logoResult;
    record.campaign.updatedAt = new Date().toISOString();

    await saveCampaign(record);
    return NextResponse.json(record);
  } catch (err) {
    console.error("Upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Check server logs for details." }, { status: 500 });
  }
}
