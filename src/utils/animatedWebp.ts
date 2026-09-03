export const animatedAvatarTargetBytes = 1_000_000;
const maxSourceBytes = 20 * 1024 * 1024;
const maxFrames = 600;
const encodingSteps = [
  { size: 256, quality: 0.8 },
  { size: 192, quality: 0.7 },
  { size: 128, quality: 0.6 },
] as const;

export class AnimatedAvatarError extends Error {
  constructor(public readonly reason: "tooLarge" | "unsupported") {
    super(reason);
  }
}

function tag(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function animatedImageMime(bytes: Uint8Array): string | null {
  if (tag(bytes, 0) === "GIF8") return "image/gif";
  if (
    tag(bytes, 0) === "RIFF" && tag(bytes, 8) === "WEBP" &&
    tag(bytes, 12) === "VP8X" && (bytes[20] & 0x02) !== 0
  ) return "image/webp";
  return null;
}

function concat(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function uint24(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function chunk(name: string, data: Uint8Array) {
  const bytes = new Uint8Array(8 + data.length + (data.length % 2));
  bytes.set(new TextEncoder().encode(name));
  new DataView(bytes.buffer).setUint32(4, data.length, true);
  bytes.set(data, 8);
  return bytes;
}

interface WebpFrame {
  webp: Uint8Array;
  duration: number;
}

// RIFF/ANMF layout: https://developers.google.com/speed/webp/docs/riff_container
export function assembleAnimatedWebp(size: number, frames: WebpFrame[], repetitions: number) {
  let hasAlpha = false;
  const frameChunks = frames.map(({ webp, duration }) => {
    if (tag(webp, 0) !== "RIFF" || tag(webp, 8) !== "WEBP") {
      throw new AnimatedAvatarError("unsupported");
    }
    const imageChunks: Uint8Array[] = [];
    let hasImage = false;
    for (let offset = 12; offset + 8 <= webp.length;) {
      const name = tag(webp, offset);
      const length = new DataView(webp.buffer, webp.byteOffset + offset + 4, 4).getUint32(0, true);
      const end = offset + 8 + length + (length % 2);
      if (end > webp.length) throw new Error("Invalid WebP frame");
      if (name === "ALPH" || name === "VP8 " || name === "VP8L") {
        imageChunks.push(webp.subarray(offset, end));
        hasImage ||= name !== "ALPH";
        hasAlpha ||= name === "ALPH" || (name === "VP8L" && (webp[offset + 12] & 0x10) !== 0);
      }
      offset = end;
    }
    if (!hasImage) throw new Error("Missing WebP frame");
    const header = new Uint8Array(16);
    uint24(header, 6, size - 1);
    uint24(header, 9, size - 1);
    uint24(header, 12, duration);
    // ImageDecoder already composites GIF disposal/blending; replace the full frame.
    header[15] = 2;
    return chunk("ANMF", concat([header, ...imageChunks]));
  });
  const extended = new Uint8Array(10);
  extended[0] = 0x02 | (hasAlpha ? 0x10 : 0);
  uint24(extended, 4, size - 1);
  uint24(extended, 7, size - 1);
  const animation = new Uint8Array(6);
  new DataView(animation.buffer).setUint16(
    4, Number.isFinite(repetitions) ? Math.min(65535, repetitions + 1) : 0, true,
  );
  const body = concat([
    new TextEncoder().encode("WEBP"), chunk("VP8X", extended),
    chunk("ANIM", animation), ...frameChunks,
  ]);
  return chunk("RIFF", body);
}

export async function encodeAnimatedWebp(
  data: Uint8Array,
  type: string,
  drawFrame: (context: CanvasRenderingContext2D, frame: VideoFrame) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  if (data.length > maxSourceBytes) throw new AnimatedAvatarError("tooLarge");
  if (typeof ImageDecoder === "undefined" || !await ImageDecoder.isTypeSupported(type)) {
    throw new AnimatedAvatarError("unsupported");
  }
  const decoder = new ImageDecoder({ data, type, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount < 2) return null;
    if (track.frameCount > maxFrames) throw new AnimatedAvatarError("tooLarge");

    for (const { size: maxSize, quality } of encodingSteps) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new AnimatedAvatarError("unsupported");
      const frames: WebpFrame[] = [];
      let bytes = 44;
      for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
        signal?.throwIfAborted();
        const { image } = await decoder.decode({ frameIndex });
        try {
          if (image.displayWidth * image.displayHeight * track.frameCount > 120_000_000) {
            throw new AnimatedAvatarError("tooLarge");
          }
          if (frameIndex === 0) {
            canvas.width = canvas.height = Math.min(maxSize, image.displayWidth, image.displayHeight);
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
          }
          context.clearRect(0, 0, canvas.width, canvas.height);
          drawFrame(context, image);
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((value) => value?.type === "image/webp"
              ? resolve(value) : reject(new AnimatedAvatarError("unsupported")), "image/webp", quality);
          });
          const webp = new Uint8Array(await blob.arrayBuffer());
          bytes += webp.length + 24;
          if (bytes > animatedAvatarTargetBytes) break;
          frames.push({ webp, duration: Math.max(1, Math.round((image.duration ?? 100_000) / 1000)) });
        } finally {
          image.close();
        }
      }
      if (frames.length !== track.frameCount) continue;
      const output = assembleAnimatedWebp(canvas.width, frames, track.repetitionCount);
      if (output.length > animatedAvatarTargetBytes) continue;
      signal?.throwIfAborted();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([output], { type: "image/webp" }));
      });
    }
    throw new AnimatedAvatarError("tooLarge");
  } finally {
    decoder.close();
  }
}
