import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Campaign, CreativeVariant } from "./types";
import { getFormat } from "./formats";

// Fixes stale brandCheck data baked into old campaign JSONs before the
// renderedHeadline fix. Specifically: tiny-tier formats (leaderboards,
// banners) that were flagged "too long" based on the full campaign headline
// rather than the shortened rendered copy. Safe to call on every load —
// only mutates variants that have a stale warn and are now correct.
function healStaleTextReadability(variants: CreativeVariant[]): boolean {
  let changed = false;
  for (const v of variants) {
    if (!v.brandCheck) continue;
    const format = getFormat(v.formatId);
    if (!format || format.copyTier !== "tiny") continue;
    const check = v.brandCheck.checks.find((c) => c.code === "text_readability");
    if (check && check.severity === "warn") {
      // tiny formats: as long as there's any headline copy, it's fine
      const hasHeadline = !!(v.renderedHeadline || v.headline || "").trim();
      check.severity = hasHeadline ? "pass" : "warn";
      check.message = hasHeadline
        ? "Good — short copy fits this small format"
        : "No headline copy — add a headline";
      if (hasHeadline) {
        // Recalculate score — remove the 5-point warn penalty
        const fails = v.brandCheck.checks.filter((c) => c.severity === "fail").length;
        const warns = v.brandCheck.checks.filter((c) => c.severity === "warn").length;
        v.brandCheck.score = Math.max(0, 100 - fails * 15 - warns * 5);
        v.brandCheck.passOrFail = fails > 0 ? "fail" : warns > 2 ? "warn" : warns > 0 ? "warn" : "pass";
        changed = true;
      }
    }
  }
  return changed;
}

// Campaign persistence — three modes in priority order:
//
//  1. Upstash Redis / Vercel KV — set KV_REST_API_URL + KV_REST_API_TOKEN
//     (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
//     Fully durable, shared across all serverless instances. Recommended
//     for production on Vercel.
//
//  2. Local filesystem — data/campaigns/<id>.json for `npm run dev`.
//     Falls back to os.tmpdir() if data/ is not writable.
//
//  3. Module-level memory cache — always active as a write-through layer
//     on top of modes 1 & 2. On Vercel without Redis, /tmp is wiped between
//     cold starts but survives within a warm invocation chain. The memory
//     cache bridges the gap: upload → save to /tmp AND cache in memory →
//     generate (same warm instance) reads from memory → works. Cold start
//     between upload and generate falls back to /tmp (usually survives a
//     few minutes on Vercel). This is intentionally a best-effort fallback;
//     Redis is the correct fix for production persistence.

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKV = !!(REDIS_URL && REDIS_TOKEN);
const INDEX_KEY = "campaigns:index";

// Module-level write-through cache — survives across requests on a warm Lambda.
const memCache = new Map<string, CampaignRecord>();

// Stable /tmp path for campaign JSON files (best-effort cross-invocation persistence).
function tmpFilePath(id: string): string {
  return path.join(os.tmpdir(), `adset-campaign-${id}.json`);
}

// Pick the local data directory — prefers project's own data/campaigns/,
// falls back to /tmp/adset-campaigns/ on read-only filesystems (Vercel).
function getDataDir(): string {
  const preferred = path.join(process.cwd(), "data", "campaigns");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, ".write-probe");
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), "adset-campaigns");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

let _dataDir: string | null = null;
function dataDir(): string {
  if (!_dataDir) _dataDir = getDataDir();
  return _dataDir;
}

interface CampaignRecord {
  campaign: Campaign;
  variants: CreativeVariant[];
}

// Per-campaign in-process mutex. updateVariant() and the campaign/format
// PATCH routes all do a read-modify-write (loadCampaign → mutate →
// saveCampaign) with no locking — two requests for the same campaign
// landing close together (e.g. clicking "Generate all" and then editing one
// variant a moment later) can interleave: both read the same pre-mutation
// record, and whichever save() finishes last silently wins, discarding the
// other's changes. Queuing same-campaign writes onto a single promise chain
// serializes them within this process, which covers the common case (one
// Node process, one warm Lambda instance). It does NOT protect against two
// *separate* concurrent serverless instances both writing the same
// campaign via Redis — that would need a real distributed lock (e.g. a
// Redis SETNX) — but that's a much rarer race in practice than the
// same-instance one this fixes, and out of scope for this pass.
const campaignLocks = new Map<string, Promise<unknown>>();

export function withCampaignLock<T>(campaignId: string, fn: () => Promise<T>): Promise<T> {
  const prior = campaignLocks.get(campaignId) ?? Promise.resolve();
  const chained = prior.catch(() => {}).then(fn);
  campaignLocks.set(campaignId, chained);
  chained.finally(() => {
    if (campaignLocks.get(campaignId) === chained) campaignLocks.delete(campaignId);
  });
  return chained;
}

let redisClient: any = null;
async function kv() {
  if (!redisClient) {
    const { Redis } = await import("@upstash/redis");
    redisClient = new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! });
  }
  return redisClient;
}

function recordKey(id: string) {
  return `campaign:${id}`;
}

function filePath(id: string) {
  return path.join(dataDir(), `${id}.json`);
}

export async function saveCampaign(record: CampaignRecord): Promise<void> {
  // Always write to memory cache first — fastest path for same-invocation reads.
  memCache.set(record.campaign.id, record);

  if (useKV) {
    const client = await kv();
    await client.set(recordKey(record.campaign.id), record);
    await client.sadd(INDEX_KEY, record.campaign.id);
    return;
  }

  const json = JSON.stringify(record, null, 2);

  // Write to primary location (local data/ or /tmp/adset-campaigns/).
  try {
    await fs.promises.writeFile(filePath(record.campaign.id), json);
  } catch {
    // Primary write failed — /tmp stable path is the last resort.
  }

  // Always also write to the stable /tmp path as a cross-invocation backup.
  // On Vercel this is the only persistent location outside of KV/Blob.
  try {
    await fs.promises.writeFile(tmpFilePath(record.campaign.id), json);
  } catch { /* best effort */ }
}

export async function loadCampaign(id: string): Promise<CampaignRecord | null> {
  // Memory cache hit — fastest, no I/O.
  const cached = memCache.get(id);
  if (cached) return cached;

  if (useKV) {
    const client = await kv();
    const record = (await client.get(recordKey(id))) as CampaignRecord | null;
    if (record) {
      healStaleTextReadability(record.variants);
      memCache.set(id, record);
    }
    return record ?? null;
  }

  // Try primary location first.
  try {
    const raw = await fs.promises.readFile(filePath(id), "utf-8");
    const record = JSON.parse(raw) as CampaignRecord;
    const healed = healStaleTextReadability(record.variants);
    memCache.set(id, record);
    // Persist the healed data so next load is clean
    if (healed) {
      const json = JSON.stringify(record, null, 2);
      fs.promises.writeFile(filePath(id), json).catch(() => {});
      fs.promises.writeFile(tmpFilePath(id), json).catch(() => {});
    }
    return record;
  } catch { /* fall through */ }

  // Try the stable /tmp backup path (Vercel cross-invocation fallback).
  try {
    const raw = await fs.promises.readFile(tmpFilePath(id), "utf-8");
    const record = JSON.parse(raw) as CampaignRecord;
    healStaleTextReadability(record.variants);
    memCache.set(id, record);
    return record;
  } catch { /* fall through */ }

  return null;
}

export async function listCampaigns(): Promise<Campaign[]> {
  if (useKV) {
    const client = await kv();
    const ids = await client.smembers(INDEX_KEY);
    const records = await Promise.all(ids.map((id: string) => client.get(recordKey(id))));
    return (records as (CampaignRecord | null)[])
      .filter((r): r is CampaignRecord => !!r)
      .map((r) => r.campaign)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  // Merge filesystem campaigns with anything in memory cache not yet on disk.
  const seen = new Set<string>();
  const results: Campaign[] = [];

  // Filesystem campaigns.
  try {
    const dir = dataDir();
    const files = await fs.promises.readdir(dir);
    for (const f of files.filter((f) => f.endsWith(".json") && f !== ".gitkeep")) {
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), "utf-8");
        const record = JSON.parse(raw) as CampaignRecord;
        seen.add(record.campaign.id);
        results.push(record.campaign);
      } catch { /* skip corrupt file */ }
    }
  } catch { /* ignore */ }

  // /tmp backup campaigns not found on disk.
  try {
    const tmpFiles = await fs.promises.readdir(os.tmpdir());
    for (const f of tmpFiles.filter((f) => f.startsWith("adset-campaign-") && f.endsWith(".json"))) {
      try {
        const raw = await fs.promises.readFile(path.join(os.tmpdir(), f), "utf-8");
        const record = JSON.parse(raw) as CampaignRecord;
        if (!seen.has(record.campaign.id)) {
          seen.add(record.campaign.id);
          results.push(record.campaign);
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  // Memory-only campaigns (just uploaded this invocation, not yet on disk).
  for (const [id, record] of memCache.entries()) {
    if (!seen.has(id)) results.push(record.campaign);
  }

  return results.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function updateVariant(campaignId: string, variant: CreativeVariant): Promise<CampaignRecord> {
  return withCampaignLock(campaignId, async () => {
    const record = await loadCampaign(campaignId);
    if (!record) throw new Error("Campaign not found");
    const idx = record.variants.findIndex((v) => v.id === variant.id);
    if (idx === -1) record.variants.push(variant);
    else record.variants[idx] = variant;
    await saveCampaign(record);
    return record;
  });
}
