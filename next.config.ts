import type { NextConfig } from "next";

// Next.js auto-detects the Turbopack project root by walking up parent
// folders looking for a lockfile (package-lock.json, yarn.lock, etc.) and
// picking the first one it finds. On the original dev machine there's a
// stray package-lock.json at C:\Users\HP\package-lock.json (unrelated to
// this project), so without this override Turbopack was treating the whole
// user folder as the project root — corrupting every module path it builds.
//
// This only matters on that one Windows machine, and a Windows-style path
// (`C:\...`) isn't a valid absolute path on Vercel's Linux build
// containers — Next would otherwise warn/misbehave there. Gated behind
// `win32` + "not running on Vercel" so it's a no-op everywhere else.
const isLocalWindowsDev = process.platform === "win32" && !process.env.VERCEL;

const nextConfig: NextConfig = {
  ...(isLocalWindowsDev
    ? { turbopack: { root: "C:\\Users\\HP\\Claude\\Projects\\image adset\\napkin-adset-builder" } }
    : {}),
  // @ffmpeg-installer/ffmpeg resolves its actual binary via a *runtime*
  // require of a platform-specific package (e.g. @ffmpeg-installer/win32-x64)
  // based on process.platform/arch. Webpack's static bundling can't follow
  // that dynamic require, so left un-excluded it errors during the server
  // build with "Cannot find module '.../package.json'". Marking it external
  // makes Next call Node's normal require for it at runtime instead of
  // trying to bundle it — the same treatment `sharp` already gets by
  // default for the same reason (native/platform-specific packages). This
  // also matters on Vercel, whose build/runtime is Linux regardless of what
  // the ffmpeg binary was resolved on locally.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg", "sharp"],
};

export default nextConfig;
