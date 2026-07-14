// @ffmpeg-installer/ffmpeg ships a prebuilt ffmpeg binary for the current
// platform/arch (win32/darwin/linux) but no TypeScript types of its own.
declare module "@ffmpeg-installer/ffmpeg" {
  const ffmpeg: { path: string; version: string; url: string };
  export default ffmpeg;
}
