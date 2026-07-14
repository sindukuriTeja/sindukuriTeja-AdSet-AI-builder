import fs from "node:fs";
import path from "node:path";
import { generateBasePlates } from "./lib/runway";
import { renderCreative } from "./lib/imageEngine";
import { getFormat } from "./lib/formats";

async function main() {
  const projectRoot = process.cwd();
  const heroPath = path.join(projectRoot, "public/uploads/33743bf0-4567-45d9-85ff-3e8305c36d90/hero.png");
  const heroRef = "/uploads/33743bf0-4567-45d9-85ff-3e8305c36d90/hero.png";
  const logoRef = "/uploads/33743bf0-4567-45d9-85ff-3e8305c36d90/logo.png";

  if (!fs.existsSync(heroPath)) {
    console.error("hero not found at", heroPath);
    process.exit(1);
  }

  console.log("Generating plates (mock fallback, no Runway key in this env)...");
  const plates = await generateBasePlates(heroRef, "quality-test-campaign", "Red Bull Energy Drink", "#0033a0");
  console.log("Plates:", plates.map((p) => `${p.bucket}:${p.source}`).join(", "));

  const testFormats = [
    "facebook_feed_1200x628",
    "instagram_feed_1080x1080",
    "iab_billboard_970x250",
  ];

  for (const fid of testFormats) {
    const format = getFormat(fid);
    if (!format) continue;
    const outKey = `generated/quality-test-campaign/formats/test_${fid}.png`;
    const result = await renderCreative({
      plates,
      format,
      headline: "Red Bull Gives You Wiiings",
      subhead: "Fuel your focus. Power your next move.",
      cta: "Get Your Wings",
      showLegal: true,
      legalCopy:
        "High caffeine content. Not recommended for children, pregnant or breastfeeding women, or persons sensitive to caffeine.",
      logoRef,
      brandPrimary: "#0033a0",
      logoPosition: "top-left",
      heroRef,
      outKey,
    });
    console.log(`${fid} -> ${result.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
