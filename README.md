# Napkin AdSet Builder — MVP

An AI ad-creative studio: upload one hero/product image + logo + campaign copy,
pick your ad formats, and get a full pack of correctly-sized static ads —
each one relaid out for its format (not just a stretched/cropped master image).

This is a working MVP scaffold, not the full product described in the brief.
It proves out the core pipeline end to end: brand intake → AI-generated base
images (via Runway) → smart-cropped, format-aware layout → brand check →
zip export. See **What's stubbed vs. real** below for what to build next.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. Create a campaign, upload a hero image + logo,
pick formats, generate, review, export.

### Runway API key

⚠️ **The Runway key you pasted in chat has been placed in `.env.local` for
local use, but because it was shared in plaintext in a chat conversation, you
should treat it as compromised — rotate/regenerate it at
https://dev.runwayml.com/ and drop the new one into `.env.local`:**

```
RUNWAYML_API_SECRET=your_new_key_here
```

Without a key (or if the Runway call fails — no credits, no network, content
moderation, etc.), the app automatically falls back to a local Sharp-based
"extend" so the pipeline still produces full ad sets for demoing. This repo
was built and tested in a sandboxed environment with no outbound access to
`api.dev.runwayml.com`, so the Runway code path is implemented and unit-clean
but hasn't been verified against a live API call — please smoke-test it once
you run this with real network access and a valid key.

## How it works

1. **Campaign setup** (`/campaigns/new`) — name, objective, brand colours,
   headline/subhead/CTA, legal copy, free-text brand guideline notes.
2. **Upload assets** (`/campaigns/[id]/upload`) — hero/product image + logo.
3. **Choose formats** (`/campaigns/[id]/formats`) — the full format catalog
   from the spec (IAB display, Google responsive display, social), grouped
   and multi-selectable.
4. **Generate & review** (`/campaigns/[id]/review`):
   - `lib/runway.ts` sends the hero image to Runway's `gen4_image` model as a
     reference image, generating 5 "base plates" (square, wide landscape,
     ultra-wide landscape, portrait, tall portrait) that extend the scene
     generatively — giving every format a properly composed background
     instead of one photo stretched five ways.
   - `lib/imageEngine.ts` picks the closest-aspect-ratio plate per format,
     smart-crops it with libvips' attention/entropy strategy (a
     dependency-free stand-in for the full face/object CV detector in the
     spec), then draws headline/subhead/CTA/logo with layout rules that
     adapt to how much room the format has (banner side-panel layout for
     wide/thin formats, bottom-scrim layout for everything else, logo-only
     centered lockup for the Google "logo asset" formats).
   - `lib/brandCheck.ts` runs a deterministic checklist (logo present/sized,
     brand colour used, WCAG contrast ratio, headline length vs. format,
     CTA present, legal copy present, layout density, safe zone) and scores
     each creative 0–100.
5. **Export** — zips every ready creative with a
   `brand_campaign_format_size_version.png` filename convention, plus
   `manifest.json` and `manifest.csv`.

## What's stubbed vs. real (read before demoing to a client)

**Real / working:**
- Full format catalog (23 sizes) matching the spec exactly.
- Runway integration code (correct SDK usage, reference-image prompting,
  graceful fallback) — verified end-to-end with the fallback path; live
  Runway calls not verified in this environment (see note above).
- Format-aware layout engine (banner / stack / logo-only modes), dynamic
  font sizing so text never overflows its box, smart cropping.
- Brand consistency scoring with WCAG contrast maths.
- Per-format regenerate, per-variant edit (headline/CTA/logo position/locks),
  zip export with manifest.

**Stubbed for the MVP (called out explicitly in the spec as "future" or
implied by "brand parser service"):**
- **Brand guideline parsing**: there's a free-text "guideline notes" field,
  but no PDF/DOCX parser extracting colours/fonts/rules automatically.
- **Font handling**: brand font *names* are stored, but every render uses a
  system sans-serif — no font file upload, matching, or web-safe fallback
  logic yet.
- **Computer vision**: cropping uses libvips' saliency heuristic, not a real
  face/product/text detector. Good enough for MVP demos, not a full CV
  pipeline.
- **Copy adaptation via LLM**: headline shortening is a word-count heuristic,
  not an LLM rewriting copy per format.
- **Persistence**: campaigns are stored as JSON files in `data/campaigns/`
  (see `lib/db.ts`) — fine for a demo, swap for Postgres/Prisma before this
  goes near real users or concurrent editing.
- **Auth / multi-user**: none. Anyone with the URL can see all campaigns.
- HTML5 export, Figma export, animated variants, A/B testing, Google/Meta
  Ads upload — all listed as "future version" in the spec, not built here.

## Project structure

```
app/                       Next.js App Router pages + API routes
  campaigns/new             Step 1: campaign setup
  campaigns/[id]/upload      Step 2: hero image + logo upload
  campaigns/[id]/formats     Step 3: format selection
  campaigns/[id]/review      Step 4: generate, review, brand-check, export
  api/campaigns/...          REST endpoints backing the above
lib/
  types.ts                  BrandKit / Campaign / AdFormat / CreativeVariant / BrandCheckReport
  formats.ts                 Full ad format catalog
  runway.ts                  Runway API integration + local fallback
  imageEngine.ts              Sharp-based compositor (the "AI layout engine")
  brandCheck.ts               Brand consistency scoring
  pipeline.ts                 Orchestrates plates → render → brand check per format
  db.ts                       File-based JSON persistence (swap for a real DB later)
public/uploads/<id>/         Uploaded hero images + logos
public/generated/<id>/       Generated base plates + final creatives
data/campaigns/<id>.json     Campaign + variant records
```

## Suggested next steps

1. Swap `lib/db.ts` for Postgres + Prisma, add auth.
2. Wire a real PDF/DOCX parser (e.g. `pdf-parse` + an LLM extraction pass) into
   the brand intake step to auto-fill colours/fonts/rules from a guideline doc.
3. Replace the entropy-based crop with a proper subject-detection model
   (e.g. a saliency or object-detection API) for `pickCropPosition`.
4. Add an LLM copy-adaptation pass (`lib/pipeline.ts` is the seam) so short
   formats get genuinely rewritten copy instead of word-truncated copy.
5. Load real brand/web fonts via `next/font/local` once font files are
   accepted at upload.
