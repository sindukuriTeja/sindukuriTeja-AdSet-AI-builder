import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { saveCampaign, loadCampaign } from "./lib/db";
import { generateForFormats } from "./lib/pipeline";
import { Campaign } from "./lib/types";
import { saveAsset } from "./lib/storage";

async function main() {
  const id = uuidv4();
  const now = new Date().toISOString();

  const campaign: Campaign = {
    id,
    campaignName: "Red Bull Energy Boost Campaign",
    objective: "Drive Sales",
    brand: {
      id: uuidv4(),
      brandName: "Red Bull",
      colors: [{ hex: "#0033a0", role: "primary" }],
      fonts: [],
      guidelineNotes: undefined,
    },
    headline: "Red Bull Gives You Wings",
    subhead: "Fuel your focus.",
    cta: "Get Your Wings",
    legalCopy: "High caffeine content. Not recommended for children.",
    selectedFormatIds: [],
    createdAt: now,
    updatedAt: now,
  };

  await saveCampaign({ campaign, variants: [] });
  console.log("Campaign created:", id);

  // reuse existing uploaded test images from the earlier real campaign
  const heroSrc = path.join(process.cwd(), "public/uploads/33743bf0-4567-45d9-85ff-3e8305c36d90/hero.png");
  const logoSrc = path.join(process.cwd(), "public/uploads/33743bf0-4567-45d9-85ff-3e8305c36d90/logo.png");
  const heroBuf = fs.readFileSync(heroSrc);
  const logoBuf = fs.readFileSync(logoSrc);

  const heroRef = await saveAsset(heroBuf, `uploads/${id}/hero.png`, "image/png");
  const logoRef = await saveAsset(logoBuf, `uploads/${id}/logo.png`, "image/png");
  console.log("hero:", heroRef, "logo:", logoRef);

  const record = await loadCampaign(id);
  if (!record) throw new Error("record missing after save");
  record.campaign.heroImagePath = heroRef;
  record.campaign.brand.logoPath = logoRef;
  record.campaign.selectedFormatIds = [
    "iab_mpu_300x250",
    "facebook_feed_1200x628",
    "instagram_feed_1080x1080",
    "stories_1080x1920",
  ];
  await saveCampaign(record);
  console.log("Assets + formats saved");

  console.log("Calling generateForFormats (mimicking the real API route + pipeline)...");
  const result = await generateForFormats(id, record.campaign.selectedFormatIds, {});
  console.log("=== RESULT ===");
  for (const v of result?.variants ?? []) {
    console.log(`${v.formatId}: ${v.status}${v.error ? " — " + v.error : ""} ${v.imagePath ? "-> " + v.imagePath.slice(0, 60) : ""}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
