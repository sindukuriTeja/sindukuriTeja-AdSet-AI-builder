import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Asset storage — three modes:
//
//  1. Vercel Blob (BLOB_READ_WRITE_TOKEN set) — durable, public, shared.
//     Connect a Blob store in Vercel dashboard → Storage for production.
//
//  2. Local public/ — `npm run dev`. Zero config.
//
//  3. Vercel without Blob — assets are saved as base64 data URIs returned
//     directly to the caller. The data URI is stored as the value of
//     heroImagePath / logoPath inside the campaign JSON record, so it
//     travels with the record across invocations without needing a separate
//     asset lookup. readAsset() decodes it inline. This means the images
//     are embedded in the campaign JSON — fine for a demo, use Blob for prod.

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const isVercel = !!process.env.VERCEL;
const PUBLIC_DIR = path.join(process.cwd(), "public");

export function storageMode(): "blob" | "local" | "embedded" {
  if (useBlob) return "blob";
  if (isVercel) return "embedded";
  return "local";
}

function isUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

function isDataUri(ref: string): boolean {
  return ref.startsWith("data:");
}

export async function saveAsset(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const normalizedKey = key.replace(/^\/+/, "");

  if (useBlob) {
    const { put } = await import("@vercel/blob");
    const blob = await put(normalizedKey, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return blob.url;
  }

  if (isVercel) {
    // Return a data URI — it gets stored directly as the asset reference
    // (heroImagePath, logoPath, imagePath) inside the campaign JSON record.
    // readAsset() decodes it inline without any separate file lookup.
    // This is the only approach that fully survives /tmp being wiped between
    // Lambda invocations when no Blob store is configured.
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  }

  // Local mode — write to public/ and return a URL path.
  const abs = path.join(PUBLIC_DIR, normalizedKey);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(
    path.dirname(abs),
    `.tmp-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e6)}-${path.basename(abs)}`
  );
  await fs.promises.writeFile(tmp, buffer);
  await fs.promises.rename(tmp, abs);
  return `/${normalizedKey}`;
}

export async function readAsset(ref: string): Promise<Buffer> {
  if (!ref) throw new Error("readAsset: empty ref");

  // Data URI — decode base64 directly, no I/O needed.
  if (isDataUri(ref)) {
    const comma = ref.indexOf(",");
    if (comma === -1) throw new Error("readAsset: malformed data URI");
    return Buffer.from(ref.slice(comma + 1), "base64");
  }

  // Remote URL (Blob store, CDN, etc.) — fetch it.
  if (isUrl(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`readAsset: fetch failed for ${ref} — HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Every local-mode ref saveAsset() ever hands back looks like
  // "/uploads/..." or "/generated/..." — a web-root-relative path, meant to
  // be resolved against public/. `path.isAbsolute()` was previously used
  // here to special-case "real" OS paths, but Node's path.isAbsolute("/foo")
  // returns true for a single leading slash on BOTH POSIX *and* Windows (it
  // means "root of the current drive" there) — so it caught every single
  // one of our own web-style refs and tried to read them literally from the
  // filesystem root (e.g. `/uploads/...` or `C:\uploads\...`) instead of
  // `public/uploads/...`, failing with ENOENT on every read. There is no
  // legitimate caller in this codebase that hands readAsset() a genuine OS
  // absolute path — heroRef/logoRef/imagePath are always one of: a data
  // URI, an https:// URL, or one of saveAsset()'s own "/..." paths — so this
  // always resolves against public/.
  const abs = path.join(PUBLIC_DIR, ref.replace(/^\/+/, ""));
  return fs.promises.readFile(abs);
}

export async function assetInfo(key: string): Promise<{ exists: boolean; url?: string }> {
  const normalizedKey = key.replace(/^\/+/, "");

  if (useBlob) {
    try {
      const { head } = await import("@vercel/blob");
      const meta = await head(normalizedKey);
      return { exists: true, url: meta.url };
    } catch {
      return { exists: false };
    }
  }

  if (isVercel) {
    // Without Blob, plates are stored as data URIs inside campaign.variants —
    // there's no separate key-addressable store to check. Always return false
    // so ensurePlates() always regenerates (which reads heroImagePath, a data
    // URI, from the campaign record). Plate data URIs are large so we don't
    // cache them; we just regenerate from the stored hero image each time.
    return { exists: false };
  }

  const abs = path.join(PUBLIC_DIR, normalizedKey);
  const exists = fs.existsSync(abs);
  return exists ? { exists: true, url: `/${normalizedKey}` } : { exists: false };
}

export async function deleteAsset(ref: string): Promise<void> {
  if (!ref || isDataUri(ref)) return; // nothing to delete for embedded data URIs
  try {
    if (useBlob && isUrl(ref)) {
      const { del } = await import("@vercel/blob");
      await del(ref);
    } else if (!isUrl(ref)) {
      // Same fix as readAsset() above — always web-root-relative, never a
      // literal OS path.
      const abs = path.join(PUBLIC_DIR, ref.replace(/^\/+/, ""));
      await fs.promises.unlink(abs).catch(() => {});
    }
  } catch { /* non-critical */ }
}
