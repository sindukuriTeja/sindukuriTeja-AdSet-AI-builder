import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { RenderInput, RenderResult, buildOverlay, pickPlate } from "./imageEngine";
import { readAsset, saveAsset } from "./storage";
import { withRetry } from "./retry";

// Renders Stories & Reels / TikTok / YouTube formats (see the `mediaType:
// "video"` formats in lib/formats.ts) as a short animated MP4 instead of a
// static PNG: a slow pan/zoom (Ken Burns effect) over the same base plate
// used for images, with the same headline/subhead/CTA/logo overlay
// (lib/imageEngine.ts's buildOverlay — shared with the image renderer so
// the two never drift apart visually) fading in over the first half-second.
//
// Uses @ffmpeg-installer/ffmpeg (a prebuilt, cross-platform ffmpeg binary
// bundled as an npm dependency) so this works out of the box on Windows/Mac/
// Linux with no separate ffmpeg install — no external API, no per-render
// cost, unlike a "real" AI video model.
//
// ffmpeg needs real files on disk to read/write (it can't operate on an
// in-memory buffer), so its intermediate frames and the encoded output
// always go through os.tmpdir() — the one place that's writable in every
// environment, including Vercel's serverless functions. The final encoded
// buffer is then handed to lib/storage.ts's saveAsset(), which is what
// actually makes it durable (Vercel Blob) or locally served (public/).

const DEFAULT_DURATION_SEC = 5;
const FPS = 25;
// The background plate is cropped this much larger than the final canvas so
// the zoom animation has room to move: it starts showing the full oversized
// crop (a mild zoom-out relative to normal framing) and animates in to
// exactly the oversized factor by the end — i.e. it zooms IN to a totally
// normal 1x crop, never needing to upscale past the plate's native
// resolution at any point in the animation.
const ZOOM_OVERSIZE = 1.18;
const FADE_IN_SEC = 0.5;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg.path, args, { maxBuffer: 1024 * 1024 * 32 }, (err, _stdout, stderr) => {
      if (err) {
        // ffmpeg's stderr is extremely verbose (build config, per-frame
        // stats); keep only the last few lines, which is almost always
        // where the actual error message is, so failures are readable in
        // server logs instead of a wall of noise.
        const tail = stderr ? stderr.toString().trim().split("\n").slice(-8).join("\n") : err.message;
        reject(new Error(`ffmpeg failed: ${tail}`));
      } else {
        resolve();
      }
    });
  });
}

export async function renderVideoCreative(input: RenderInput): Promise<RenderResult> {
  const { format } = input;
  const plate = pickPlate(input.plates, format);
  const durationSec = format.videoDurationSec ?? DEFAULT_DURATION_SEC;

  // h264 + yuv420p require even output dimensions.
  const outW = format.width % 2 === 0 ? format.width : format.width + 1;
  const outH = format.height % 2 === 0 ? format.height : format.height + 1;

  // Crop the plate larger than the output so the Ken Burns zoom has room.
  const oversizedW = Math.round(format.width * ZOOM_OVERSIZE / 2) * 2;
  const oversizedH = Math.round(format.height * ZOOM_OVERSIZE / 2) * 2;

  const plateBuf = await readAsset(plate.url);

  // 1. Crop the Runway scene (already contains the product) to the oversized
  //    canvas. No compositeProduct() call — the product is baked into the scene.
  const bgBuf = await withRetry(() =>
    sharp(plateBuf)
      .resize(oversizedW, oversizedH, { fit: "cover", position: sharp.strategy.attention })
      .png()
      .toBuffer()
  );

  // 2. Build the text/scrim/logo overlay on a transparent canvas so ffmpeg
  //    can layer it over the animated background with a fade-in.
  const { composites, bg, textColor } = await buildOverlay(input);
  const overlayBuf = await sharp({
    create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const outDir = os.tmpdir();
  const stamp = `${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const bgPath = path.join(outDir, `.tmp-bg-${stamp}.png`);
  const overlayPath = path.join(outDir, `.tmp-ov-${stamp}.png`);
  const tmpOut = path.join(outDir, `.tmp-out-${stamp}.mp4`);

  await withRetry(() => fs.promises.writeFile(bgPath, bgBuf));
  await withRetry(() => fs.promises.writeFile(overlayPath, overlayBuf));

  let finalBuf: Buffer;
  try {
    const totalFrames = Math.max(1, Math.round(durationSec * FPS));
    const zoomStep = (ZOOM_OVERSIZE - 1) / totalFrames;
    // Start fully zoomed out (showing the full oversized plate) and zoom IN
    // to 1.0x by the end. zoompan's 'zoom' is relative to output size, so
    // zoom=ZOOM_OVERSIZE means the output window is 1/ZOOM_OVERSIZE of the
    // input (i.e. zoomed in), and zoom=1 means the output == input (fully
    // zoomed out). We want the opposite: start showing everything (zoom=1)
    // and end cropped to 1/ZOOM_OVERSIZE. zoompan's z expression starts at
    // frame 0 with zoom=1 by default, so we explicitly set the initial zoom
    // to 1 and increment toward ZOOM_OVERSIZE.
    const filter =
      `[0:v]zoompan=z='if(eq(on,1),1,min(zoom+${zoomStep.toFixed(6)},${ZOOM_OVERSIZE}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${outW}x${outH}:fps=${FPS}[bg];` +
      `[1:v]format=rgba,fade=t=in:st=0:d=${FADE_IN_SEC}:alpha=1[ov];` +
      `[bg][ov]overlay=0:0:format=auto,format=yuv420p[outv]`;

    await withRetry(
      () =>
        runFfmpeg([
          "-y",
          "-framerate", String(FPS),
          "-loop", "1", "-t", String(durationSec), "-i", bgPath,
          "-framerate", String(FPS),
          "-loop", "1", "-t", String(durationSec), "-i", overlayPath,
          "-filter_complex", filter,
          "-map", "[outv]",
          "-t", String(durationSec),
          "-r", String(FPS),
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-an",
          tmpOut,
        ]),
      2
    );

    finalBuf = await fs.promises.readFile(tmpOut);
  } finally {
    // Best-effort cleanup — a leftover temp frame/clip on failure shouldn't
    // itself throw and mask the real error from the catch above.
    await Promise.all(
      [bgPath, overlayPath, tmpOut].map((p) => fs.promises.unlink(p).catch(() => {}))
    );
  }

  const url = await saveAsset(finalBuf, input.outKey, "video/mp4");
  return { url, basePlateUsed: plate.bucket, bgColorUsed: bg, textColorUsed: textColor };
}
