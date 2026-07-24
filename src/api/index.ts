import type {
  AnalyzeResponse, FormatDna, FormatSummary, GenerationRun, Job, ModelProfile, VariationStrength,
} from '@shared/contract';
import { ANALYZE_FIELDS } from '@shared/fields';
import { apiFetch } from './client';

export interface LibraryQuery {
  archetype?: string;
  formatType?: string;
  tag?: string;
  rating?: string;
  platform?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface FormatDetail {
  summary: FormatSummary;
  dna: FormatDna | Record<string, unknown>;   // 0-legacy rows carry a stub object
  legacyMarkdown?: string;
}

export function analyzeUrl(videoUrl: string): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.append(ANALYZE_FIELDS.videoUrl, videoUrl);
  return apiFetch<AnalyzeResponse>('/analyze', { method: 'POST', body: form, timeoutMs: 570_000 });
}

export function analyzeFile(file: File): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.append(ANALYZE_FIELDS.video, file);
  return apiFetch<AnalyzeResponse>('/analyze', { method: 'POST', body: form, timeoutMs: 570_000 });
}

export function listFormats(query: LibraryQuery = {}): Promise<{ total: number; items: FormatSummary[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return apiFetch(`/formats${qs ? `?${qs}` : ''}`);
}

export function getFormat(id: string): Promise<FormatDetail> {
  return apiFetch(`/formats/${id}`);
}

export function deleteFormat(id: string): Promise<{ deleted: string }> {
  return apiFetch(`/formats/${id}`, { method: 'DELETE' });
}

export function listProfiles(): Promise<{ items: { id: string; name: string; version: number; updatedAt: string }[] }> {
  return apiFetch('/profiles');
}

export function getProfile(id: string): Promise<ModelProfile> {
  return apiFetch(`/profiles/${id}`);
}

/** Upsert — PUT creates or updates; the server bumps the version on every write. */
export function putProfile(profile: ModelProfile): Promise<{ id: string; version: number }> {
  return apiFetch(`/profiles/${profile.id}`, { method: 'PUT', json: profile });
}

export function deleteProfile(id: string): Promise<{ deleted: string }> {
  return apiFetch(`/profiles/${id}`, { method: 'DELETE' });
}

/** Character-neutral by default; pass profileId only to bind a model profile (optional layer). */
export function generateIdeations(
  formatId: string, variationStrength: VariationStrength, profileId?: string,
): Promise<GenerationRun> {
  return apiFetch('/generate', {
    method: 'POST',
    json: { formatId, variationStrength, ...(profileId ? { profileId } : {}) },
    timeoutMs: 570_000,
  });
}

export function listGenerations(formatId: string): Promise<{
  items: { id: string; profileId: string; variationStrength: string; status: string; createdAt: string }[];
}> {
  return apiFetch(`/formats/${formatId}/generations`);
}

export function getGeneration(id: string): Promise<GenerationRun> {
  return apiFetch(`/generations/${id}`);
}

export function getJob(id: string): Promise<Job> {
  return apiFetch(`/jobs/${id}`);
}

export function listVersions(id: string): Promise<{ formatId: string; versions: { version: number; created_at: string }[] }> {
  return apiFetch(`/formats/${id}/versions`);
}

export function getVersion(id: string, version: number): Promise<{ formatId: string; version: number; dna: FormatDna; snapshotAt: string }> {
  return apiFetch(`/formats/${id}/versions/${version}`);
}

/** Markdown brief (DNA + latest generations) — returns raw text for the clipboard. */
export async function exportMarkdown(id: string): Promise<string> {
  const { API_BASE, TOKEN_STORAGE_KEY } = await import('../config');
  const res = await fetch(`${API_BASE}/formats/${id}/export?fmt=markdown`, {
    headers: { 'X-API-Key': localStorage.getItem(TOKEN_STORAGE_KEY) ?? '' },
  });
  if (!res.ok) throw new Error(`export failed: HTTP ${res.status}`);
  return res.text();
}
