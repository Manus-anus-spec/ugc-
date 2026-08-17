/**
 * URL → direct video URL resolvers, ported from worker-v4.2.0.js:260-328 with two changes:
 *  - each resolver also returns the platform thumbnail when the API provides one
 *  - failures throw typed ResolverError with an actionable message (never a silent null → fixes plan risk #8)
 * File upload stays the always-works fallback.
 */
import type { Platform } from '../../shared/contract';
import { detectPlatform } from '../../shared/platform';

export class ResolverError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

export interface ResolvedVideo {
  platform: Platform;
  /** Direct fetchable mp4 URL — null for YouTube (fed to Gemini as fileUri passthrough). */
  directUrl: string | null;
  thumbnailUrl?: string;
  isYouTube: boolean;
}

const UA_BOT = 'Mozilla/5.0 (compatible; UGCBot/1.0)';
const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function resolveTikTok(u: string): Promise<ResolvedVideo> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(u)}&hd=1`;
  const res = await fetch(apiUrl, { headers: { 'User-Agent': UA_BOT } });
  if (!res.ok) throw new ResolverError(`TikTok resolver (tikwm) returned ${res.status} — try again or upload the file directly.`, 502);
  const data = await res.json() as { data?: { hdplay?: string; play?: string; wmplay?: string; cover?: string; origin_cover?: string } };
  const directUrl = data?.data?.hdplay || data?.data?.play || data?.data?.wmplay || null;
  if (!directUrl) throw new ResolverError('Could not resolve TikTok video. Make sure the video is public, or upload the file directly.');
  return { platform: 'tiktok', directUrl, thumbnailUrl: data?.data?.cover || data?.data?.origin_cover, isYouTube: false };
}

async function resolveInstagram(u: string, rapidApiKey: string | undefined): Promise<ResolvedVideo> {
  if (!rapidApiKey) throw new ResolverError('Instagram download not configured: RAPIDAPI_KEY secret is missing.', 500);
  const apiUrl = `https://instagram-reels-downloader-api.p.rapidapi.com/download?url=${encodeURIComponent(u)}`;
  const res = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': 'instagram-reels-downloader-api.p.rapidapi.com',
      'x-rapidapi-key': rapidApiKey,
    },
  });
  if (!res.ok) throw new ResolverError(`Instagram resolver returned ${res.status} — the Reel may be private, or the RapidAPI quota is exhausted. Upload the file directly as a fallback.`, 502);
  const data = await res.json() as {
    url?: string; video_url?: string; thumbnail?: string;
    data?: { url?: string; thumbnail?: string }[];
  };
  const directUrl = data?.url || data?.data?.[0]?.url || data?.video_url || null;
  if (!directUrl) throw new ResolverError('Could not resolve Instagram video. Make sure it is a public Reel and the URL is correct.');
  return { platform: 'instagram', directUrl, thumbnailUrl: data?.thumbnail || data?.data?.[0]?.thumbnail, isYouTube: false };
}

async function resolvePinterest(u: string): Promise<ResolvedVideo> {
  let fullUrl = u;
  if (u.includes('pin.it')) {
    const redirectRes = await fetch(u, { redirect: 'follow' });
    fullUrl = redirectRes.url || u;
  }
  const pageRes = await fetch(fullUrl, {
    headers: { 'User-Agent': UA_BROWSER, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  if (!pageRes.ok) throw new ResolverError(`Pinterest returned ${pageRes.status} for that pin.`, 502);
  const html = await pageRes.text();
  const directUrl =
    html.match(/"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/)?.[1] ||
    html.match(/"V_720P"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"V_EXP7"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/)?.[1] || null;
  if (!directUrl) throw new ResolverError('Could not extract Pinterest video. Make sure the pin contains a video and is publicly accessible.');
  return { platform: 'pinterest', directUrl, isYouTube: false };
}

/** Resolve any supported URL. YouTube is passed to Gemini directly (no download). */
export async function resolveVideoUrl(u: string, rapidApiKey: string | undefined): Promise<ResolvedVideo> {
  const platform = detectPlatform(u);
  switch (platform) {
    case 'youtube': return { platform, directUrl: null, isYouTube: true };
    case 'tiktok': return resolveTikTok(u);
    case 'instagram': return resolveInstagram(u, rapidApiKey);
    case 'pinterest': return resolvePinterest(u);
    default:
      throw new ResolverError('Unsupported URL. Use YouTube Shorts, TikTok, Instagram Reels, or Pinterest — or upload the video file directly.');
  }
}

/** Download the resolved video into memory for the Gemini File API. */
export async function fetchVideo(directUrl: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const res = await fetch(directUrl, { headers: { 'User-Agent': UA_BOT } });
  if (!res.ok) throw new ResolverError(`Failed to fetch resolved video: HTTP ${res.status}`, 502);
  const ct = res.headers.get('content-type') || '';
  const mimeType = ct.includes('video/') ? ct.split(';')[0]!.trim() : 'video/mp4';
  return { buffer: await res.arrayBuffer(), mimeType };
}
