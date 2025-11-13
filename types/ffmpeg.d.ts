import { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpeg: FFmpeg | null = null;

async function ensureFFmpeg() {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    await ffmpeg.load();
  }
  return ffmpeg;
}

// example usage
async function transcode(blob: Blob) {
  const f = await ensureFFmpeg();
  const data = new Uint8Array(await blob.arrayBuffer());
  await f.writeFile("in.webm", data);
  await f.exec(["-i", "in.webm", "-c:a", "libmp3lame", "out.mp3"]);
  const out = await f.readFile("out.mp3");
  return new Blob([out], { type: "audio/mpeg" });
}