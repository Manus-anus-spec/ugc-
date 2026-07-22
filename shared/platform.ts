/**
 * shared/platform.ts — URL → platform detection.
 * Mirrors the worker's resolver list one-to-one (FABLE5-PLAN §4 "URL ingestion fixed").
 * The frontend's old isValidUrl (which silently blocked Instagram) is replaced by this.
 */
import type { Platform } from './contract';

const HOST_RULES: { platform: Platform; hosts: string[] }[] = [
  { platform: 'tiktok', hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'] },
  { platform: 'instagram', hosts: ['instagram.com', 'instagr.am'] },
  { platform: 'youtube', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { platform: 'pinterest', hosts: ['pinterest.com', 'pin.it'] },
];

/** Detect the platform of a pasted URL. Returns null when unsupported/unparseable. */
export function detectPlatform(url: string): Platform | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const rule of HOST_RULES) {
    if (rule.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return rule.platform;
  }
  return null;
}

export function isSupportedUrl(url: string): boolean {
  return detectPlatform(url) !== null;
}
