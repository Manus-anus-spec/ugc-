import type { AnalyzeResponse, FormatDna, FormatSummary } from '@shared/contract';
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
