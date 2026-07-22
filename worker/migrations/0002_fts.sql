-- 0002: full-text search over the library (FABLE5-PLAN Phase 5).
-- Standalone FTS5 table (id UNINDEXED), synced at application level on every
-- format insert/update/delete — contentless/external-content FTS can't handle
-- our JSON-derived text, and app-level sync is unit-testable.
CREATE VIRTUAL TABLE formats_fts USING fts5(
  id UNINDEXED,
  title,
  archetype,
  hook_text,
  why_it_works,
  tags
);
