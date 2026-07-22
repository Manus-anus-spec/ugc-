/**
 * shared/fields.ts — canonical multipart/header/query names, exported as constants
 * so the frontend and worker literally cannot drift (kills the url/videoUrl bug class).
 */
export const ANALYZE_FIELDS = {
  /** multipart field: pasted URL (string) */
  videoUrl: 'videoUrl',
  /** multipart field: uploaded file */
  video: 'video',
} as const;

export const AUTH_HEADER = 'X-API-Key';

/** Query params accepted by GET /formats */
export const FORMAT_LIST_PARAMS = {
  archetype: 'archetype',
  tag: 'tag',
  rating: 'rating',
  platform: 'platform',
  q: 'q',            // LIKE search over title/archetype (FTS lands in Phase 5)
  limit: 'limit',
  offset: 'offset',
} as const;
