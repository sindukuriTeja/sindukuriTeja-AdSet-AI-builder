import { NextRequest } from "next/server";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { loadCampaign } from "@/lib/db";
import { getFormat } from "@/lib/formats";
import { slugify } from "@/lib/util";
import { readAsset } from "@/lib/storage";

// Streams a zip of every ready creative plus a JSON + CSV manifest, using the
// brand_campaign_format_size_version.png filename convention from the spec.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadCampaign(id);
  if (!record) return new Response("Not found", { status: 404 });

  const { campaign, variants } = record;
  const brandSlug = slugify(campaign.brand.brandName);
  const campaignSlug = slugify(campaign.campaignName);
  const ready = variants.filter((v) => v.status === "ready" && v.imagePath);

  const manifestRows = ready.map((v) => {
    const format = getFormat(v.formatId);
    // Video formats (Stories & Reels / TikTok / YouTube) render an .mp4, not
    // a .png — match whatever v.imagePath's real extension is rather than
    // hardcoding one, so the zip entry name doesn't lie about the file type.
    const ext = v.imagePath?.split(".").pop() || (format?.mediaType === "video" ? "mp4" : "png");
    const fileName = `${brandSlug}_${campaignSlug}_${slugify(format?.name || v.formatId)}_${format?.width}x${format?.height}_v${String(v.version).padStart(2, "0")}.${ext}`;
    return {
      fileName,
      formatId: v.formatId,
      formatName: format?.name,
      width: format?.width,
      height: format?.height,
      platform: format?.platform,
      headline: v.headline,
      subhead: v.subhead,
      cta: v.cta,
      brandCheck: v.brandCheck?.passOrFail,
      score: v.brandCheck?.score,
      imagePath: v.imagePath,
    };
  });

  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = new PassThrough();
  // archiver/its output stream emit "error" as a plain EventEmitter event —
  // with no listener attached, Node treats that as an uncaught exception and
  // crashes the whole server process (this is a separate mechanism from
  // promise rejections, so it isn't covered by any try/catch here). A
  // mid-stream failure (e.g. a file that existed at the existsSync check
  // above but got removed/locked by the time archiver reads it) would take
  // the whole dev server down instead of just failing this one download.
  archive.on("error", (err) => {
    console.error(`Export archive failed for campaign ${id}:`, err);
    stream.destroy(err);
  });
  stream.on("error", (err) => {
    console.error(`Export stream failed for campaign ${id}:`, err);
  });
  archive.pipe(stream);

  // readAsset() transparently fetches a Blob URL or reads a local public/
  // path — whichever mode lib/storage.ts is running in — so the export
  // route doesn't need to know or care where the files actually live.
  // Fetched/read into memory rather than streamed via archive.file(), since
  // archive.file() only accepts a local filesystem path. Sequential (not
  // Promise.all) so the zip's entry order matches manifestRows and we don't
  // fire a burst of concurrent fetches against the Blob store.
  for (const row of manifestRows) {
    try {
      const buf = await readAsset(row.imagePath!);
      archive.append(buf, { name: row.fileName });
    } catch (err) {
      console.error(`Export: couldn't read asset for ${row.fileName}:`, err);
    }
  }

  archive.append(JSON.stringify({ campaign: campaign.campaignName, brand: campaign.brand.brandName, assets: manifestRows }, null, 2), {
    name: "manifest.json",
  });

  const csvHeader = "fileName,formatName,width,height,platform,headline,cta,brandCheck,score\n";
  const csvBody = manifestRows
    .map((r) => [r.fileName, r.formatName, r.width, r.height, r.platform, r.headline, r.cta, r.brandCheck, r.score].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  archive.append(csvHeader + csvBody, { name: "manifest.csv" });

  archive.finalize();

  return new Response(stream as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${brandSlug}_${campaignSlug}_adpack.zip"`,
    },
  });
}
