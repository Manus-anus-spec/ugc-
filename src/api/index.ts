import type {
  AnalyzeResponse, FormatDna, FormatSummary, GenerationRun, ModelProfile, VariationStrength,
} from '@shared/contract';
import { ANALYZE_FIELDS } from '@shared/fields';
import { apiFetch } from './client';

export interface LibraryQuery {
  archetype?: string;
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

export function generateIdeations(
  formatId: string, profileId: string, variationStrength: VariationStrength,
): Promise<GenerationRun> {
  return apiFetch('/generate', {
    method: 'POST',
    json: { formatId, profileId, variationStrength },
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
