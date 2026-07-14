import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mime from "mime-types";

const isVercel = !!process.env.VERCEL;
const PUBLIC_DIR = path.join(process.cwd(), "public");
const TMP_DIR = path.join(os.tmpdir(), "adset-assets");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const relPath = segments.join("/");

  const base = isVercel ? TMP_DIR : PUBLIC_DIR;
  const abs = path.join(base, relPath);

  // Prevent path traversal
  if (!abs.startsWith(base)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const buffer = await fs.promises.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const contentType = mime.lookup(ext) || "application/octet-stream";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
