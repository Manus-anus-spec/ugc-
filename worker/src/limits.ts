/**
 * Byte caps and fetch-target safety for the paid ingestion path (§P2 hardening).
 *
 * Two gaps this closes, and an honest note on the severity of each:
 *
 * 1. NO BYTE CAP EXISTED ANYWHERE. analyze.ts gated only on DURATION
 *    (HIGH_RES_MAX_SEC=90, SHORT_FORM_MAX_SEC=60) and Cloudflare's 100MB request limit was
 *    the sole backstop on uploads — while `fetchVideo` had no limit at all, since a resolved
 *    CDN URL is fetched with an unbounded `res.arrayBuffer()`. A worker gets ~128MB of
 *    memory, so a large file OOMs the isolate mid-run, and every byte is then uploaded to
 *    the Gemini File API, which is billable. This is the genuinely useful half.
 *
 * 2. SSRF via the RESOLVED url. Caller-supplied URLs are already well gated:
 *    detectPlatform() parses with `new URL` and matches the hostname exactly or as a
 *    suffix, so "https://tiktok.com@169.254.169.254/" and "evil.tiktok.com.attacker.com"
 *    both fail closed. What is NOT caller-gated is the DIRECT url that comes back from a
 *    platform API or an HTML scrape, which `fetchVideo` then requests with redirects
 *    followed. A hostile or compromised upstream response could aim that at an internal
 *    address.
 *
 *    Severity is genuinely low, and overstating it would be wrong: a Workers `fetch` egresses
 *    through Cloudflare's network, so loopback and RFC1918 are not reachable the way they are
 *    from an EC2 instance with a metadata endpoint. This is defence in depth on a path that
 *    already requires an authenticated operator — cheap to add, so worth adding, not a
 *    patched breach.
 */

/** 96MB. Under Cloudflare's 100MB request ceiling and well under the ~128MB isolate memory
 *  limit, while still comfortably above any real short-form video (a 90s 4K clip is ~40MB). */
export const MAX_VIDEO_BYTES = 96 * 1024 * 1024;

export const MAX_VIDEO_MB = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));

export class LimitError extends Error {
  constructor(message: string, public readonly status = 413, public readonly code = 'too_large') {
    super(message);
  }
}

const PRIVATE_IPV4 =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** Reject a fetch target that is not a public http(s) endpoint.
 *
 *  Hostnames are NOT resolved here — a Worker cannot do DNS lookups, so a name pointing at
 *  a private address (DNS rebinding) is not detectable at this layer. That is stated rather
 *  than implied: this blocks the literal-IP and non-http(s) cases, which is what a scraped
 *  or API-returned URL realistically carries. */
export function assertSafeFetchTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LimitError(`Resolved video URL is not a valid URL: ${rawUrl.slice(0, 80)}`, 502, 'bad_resolved_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new LimitError(`Refusing to fetch a non-http(s) URL (${url.protocol})`, 502, 'unsafe_resolved_url');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host.startsWith('fe80:') ||        // IPv6 link-local
    host.startsWith('fc') || host.startsWith('fd') ||   // IPv6 unique-local
    PRIVATE_IPV4.test(host);
  if (isPrivate) {
    throw new LimitError(`Refusing to fetch an internal address (${host})`, 502, 'unsafe_resolved_url');
  }
  return url;
}

/** Read a response body with a hard byte ceiling.
 *
 *  Content-Length is checked first when present (cheapest possible rejection — no bytes
 *  read), but it is advisory and absent on chunked responses, so the stream is ALSO counted
 *  as it arrives and aborted the moment it crosses the cap. Trusting the header alone is
 *  the classic way a "capped" download stays uncapped. */
export async function readCappedBody(
  res: Response, max: number = MAX_VIDEO_BYTES, what = 'video',
): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    throw new LimitError(
      `${what} is ${Math.round(declared / (1024 * 1024))}MB — over the ${MAX_VIDEO_MB}MB limit. Trim the clip and retry.`,
    );
  }
  if (!res.body) return new ArrayBuffer(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);   // stop paying for bytes we reject
      throw new LimitError(
        `${what} exceeds the ${MAX_VIDEO_MB}MB limit (still streaming at ${Math.round(total / (1024 * 1024))}MB). Trim the clip and retry.`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out.buffer;
}

/** Extension → MIME for the container formats Gemini accepts for video. */
const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  '3gp': 'video/3gpp', flv: 'video/x-flv', wmv: 'video/x-ms-wmv',
};

/** Leading magic bytes → MIME, for when the filename is useless too. */
const MAGIC: { mime: string; at: number; bytes: number[] }[] = [
  { mime: 'video/mp4', at: 4, bytes: [0x66, 0x74, 0x79, 0x70] },      // ....ftyp (mp4/mov/3gp)
  { mime: 'video/webm', at: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },     // EBML (webm/mkv)
  { mime: 'video/x-msvideo', at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },// RIFF (avi)
];

/**
 * Decide the MIME type to hand Gemini for an uploaded video.
 *
 * WHY THIS EXISTS: `file.type || 'video/mp4'` looks like a safe fallback and is not. A plain
 * `curl -F "video=@clip.mp4"` sends `application/octet-stream`, which is TRUTHY — so it sailed
 * past the fallback into Gemini, which rejected it with
 *   400 "Unsupported MIME type: application/octet-stream"
 * That is an opaque Google error for what is really a client formatting detail, and it only
 * worked if the caller happened to know to write `;type=video/mp4`. Requiring callers to
 * annotate the part correctly is not a real contract.
 *
 * Order: trust a declared `video/*` type, else infer from the extension, else sniff the magic
 * bytes, else fall back to mp4 (by far the most common) rather than failing the upload.
 */
export function resolveVideoMime(declaredType: string, filename: string, head?: Uint8Array): string {
  if (/^video\//i.test(declaredType)) return declaredType.split(';')[0]!.trim().toLowerCase();

  const ext = filename.toLowerCase().match(/\.([a-z0-9]{2,4})$/)?.[1];
  if (ext && EXT_MIME[ext]) return EXT_MIME[ext];

  if (head && head.length >= 12) {
    for (const sig of MAGIC) {
      if (sig.bytes.every((b, i) => head[sig.at + i] === b)) return sig.mime;
    }
  }
  return 'video/mp4';
}

/** Cap an already-materialised upload (a File/Blob from multipart form data). */
export function assertUploadWithinCap(size: number, what = 'uploaded video'): void {
  if (size > MAX_VIDEO_BYTES) {
    throw new LimitError(
      `${what} is ${Math.round(size / (1024 * 1024))}MB — over the ${MAX_VIDEO_MB}MB limit. Trim the clip and retry.`,
    );
  }
}
