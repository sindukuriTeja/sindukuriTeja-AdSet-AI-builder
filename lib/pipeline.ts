import { v4 as uuidv4 } from "uuid";
import { loadCampaign, updateVariant } from "./db";
import { generateSceneForFormat, BasePlate } from "./runway";
import { renderCreative } from "./imageEngine";
import { runBrandCheck } from "./brandCheck";
import { getFormat, bucketFor } from "./formats";
import { CreativeVariant } from "./types";
import { readAsset } from "./storage";
import { withRetry } from "./retry";
import { generateConceptsForFormats } from "./claude";

// ─── Director-mode pipeline ──────────────────────────────────────────────────
//
// Flow per format:
//   1. Claude writes a complete scene prompt (environment + product + action)
//   2. Runway renders the full photorealistic scene as one image
//   3. The render engine crops it to format dimensions
//   4. Text + logo SVG overlay is composited on top
//   5. Brand check scored and saved
//
// The product photo upload is used as reference/inspiration for Claude's
// vision analysis but is NOT composited as a separate layer — it lives
// inside the Runway scene.

export async function generateForFormats(
  campaignId: string,
  formatIds: string[],
  opts: { force?: boolean } = {},
) {
  const record = await loadCampaign(campaignId);
  if (!record) throw new Error("Campaign not found");
  const { campaign } = record;
  if (!campaign.heroImagePath) throw new Error("Upload a hero image before generating");

  const campaignPrimary = campaign.brand.colors.find((c) => c.role === "primary")?.hex || "#c8102e";
  const logoRef = campaign.brand.logoPath;
  const heroRef = campaign.heroImagePath;

  // Load the hero buffer for Claude's vision — so it can describe the
  // actual product accurately in the scene prompt.
  const heroBufForClaude = await readAsset(heroRef).catch(() => undefined as Buffer | undefined);

  const formats = formatIds.map(getFormat).filter(Boolean) as NonNullable<ReturnType<typeof getFormat>>[];

  // ── Step 1: Claude generates a unique concept + scene prompt per format ───
  console.log(`[pipeline] Generating ${formats.length} creative concepts via Claude…`);
  const concepts = await generateConceptsForFormats(
    formats,
    campaign.brand,
    campaign.headline,
    campaign.subhead,
    campaign.cta,
    heroBufForClaude,
    campaign.objective,
    5,
    campaign.preferredStyles,
  );

  // ── Step 2: Runway generates a unique scene per format ───────────────────
  // Run up to 4 Runway calls in parallel to stay within rate limits.
  console.log(`[pipeline] Generating ${formats.length} Runway scenes…`);
  const CONCURRENCY = 4;
  const scenePlates = new Map<string, BasePlate>();

  for (let i = 0; i < formats.length; i += CONCURRENCY) {
    const chunk = formats.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (f) => {
        const concept = concepts.get(f.id) ?? {
          style: "full_bleed_scrim" as const,
          headline: campaign.headline,
          subhead: campaign.subhead ?? "",
          cta: campaign.cta,
          bgColor: campaignPrimary,
          accentColor: "#ffffff",
          textColor: "#ffffff",
          overlayOpacity: 0.65,
          conceptNote: "fallback",
          scenePrompt: "",
          sceneTag: "fallback",
        };
        const plate = await generateSceneForFormat(
          f.id,
          campaignId,
          bucketFor(f),
          concept,
          campaignPrimary,
        );
        return [f.id, plate] as [string, BasePlate];
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") scenePlates.set(r.value[0], r.value[1]);
    }
  }

  // ── Step 3: Render each format — crop scene + overlay text + logo ────────
  for (const format of formats) {
    const formatId = format.id;
    const existing = record.variants.find((v) => v.formatId === formatId);
    if (existing && existing.locks.crop && existing.status === "ready" && !opts.force) continue;

    const variant: CreativeVariant = existing ?? {
      id: uuidv4(),
      campaignId,
      formatId,
      status: "pending",
      headline: campaign.headline,
      subhead: campaign.subhead,
      cta: campaign.cta,
      showLegal: !!campaign.legalCopy,
      logoPosition: "top-left",
      locks: { crop: false, headline: false, logo: false },
      version: 0,
      updatedAt: new Date().toISOString(),
    };

    try {
      const isVideo = format.mediaType === "video";
      const ext = isVideo ? "mp4" : "png";
      const outKey = `generated/${campaignId}/formats/${formatId}_v${variant.version + 1}_${Date.now()}.${ext}`;

      const effectiveHeadline = variant.locks.headline ? variant.headline : campaign.headline;
      const concept = concepts.get(formatId);

      const scenePlate = scenePlates.get(formatId);
      // Fallback plate wraps the mock gradient already saved by generateSceneForFormat
      const platesForFormat: BasePlate[] = scenePlate
        ? [scenePlate]
        : [{ bucket: bucketFor(format), url: heroRef, source: "mock" as const }];

      const renderInput = {
        plates: platesForFormat,
        format,
        headline: effectiveHeadline,
        subhead: campaign.subhead,
        cta: campaign.cta,
        showLegal: variant.showLegal,
        legalCopy: campaign.legalCopy,
        logoRef: variant.locks.logo ? undefined : logoRef,
        heroRef, // kept for brand-check reference; NOT composited in renderCreative
        brandPrimary: campaignPrimary,
        bgColorOverride: variant.bgColor,
        logoPosition: variant.logoPosition,
        brandFont: campaign.brand.fonts[0],
        outKey,
        concept,
      };

      const result = await withRetry(async () => {
        if (isVideo) {
          const { renderVideoCreative } = await import("./videoEngine");
          return renderVideoCreative(renderInput);
        }
        return renderCreative(renderInput);
      }, 2);

      const renderedHeadline = concept?.headline ?? effectiveHeadline;
      const brandCheck = await runBrandCheck(
        {
          ...variant,
          imagePath: result.url,
          headline: effectiveHeadline,
          subhead: campaign.subhead,
          cta: campaign.cta,
          legalCopy: campaign.legalCopy,
          bgColor: result.bgColorUsed,
          textColor: result.textColorUsed,
        },
        format,
        campaign.brand,
        logoRef,
        scenePlate?.url ?? heroRef,
        renderedHeadline,
      );

      variant.headline = effectiveHeadline;
      variant.renderedHeadline = renderedHeadline;
      variant.subhead = campaign.subhead;
      variant.cta = campaign.cta;
      variant.legalCopy = campaign.legalCopy;
      variant.imagePath = result.url;
      variant.basePlateUsed = result.basePlateUsed;
      variant.bgColor = result.bgColorUsed;
      variant.textColor = result.textColorUsed;
      variant.status = "ready";
      variant.error = undefined;
      variant.version += 1;
      variant.updatedAt = new Date().toISOString();
      variant.brandCheck = brandCheck;
      await updateVariant(campaignId, variant);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] Failed to render ${formatId}:`, message);
      variant.status = "failed";
      variant.error = message;
      await updateVariant(campaignId, variant);
    }
  }

  return loadCampaign(campaignId);
}
