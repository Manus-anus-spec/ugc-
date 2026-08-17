-- ugc_library · 0001_init
-- FABLE5-PLAN §2.2 amended: tenant_id everywhere (risk #7), no FTS yet (Phase 5,
-- external-content FTS5 + triggers — contentless FTS can't handle UPDATE/DELETE).

CREATE TABLE formats (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'aruna',
  title TEXT NOT NULL,
  archetype TEXT NOT NULL,
  hook_type TEXT,
  content_rating TEXT,
  duration_sec REAL,
  clip_count INTEGER,
  platform TEXT,
  source_url TEXT,
  thumbnail_url TEXT,
  schema_version TEXT NOT NULL DEFAULT '1',   -- '0-legacy' for migrated KV entries
  current_version INTEGER NOT NULL DEFAULT 1,
  dna TEXT NOT NULL,                          -- FormatDNA JSON (current version)
  legacy_markdown TEXT,                       -- only for 0-legacy rows (old full_analysis)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_formats_archetype ON formats(archetype);
CREATE INDEX idx_formats_rating ON formats(content_rating);
CREATE INDEX idx_formats_platform ON formats(platform);
CREATE INDEX idx_formats_tenant ON formats(tenant_id);
CREATE INDEX idx_formats_updated ON formats(updated_at DESC);

CREATE TABLE format_versions (
  format_id TEXT NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  dna TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (format_id, version)
);

CREATE TABLE format_tags (
  format_id TEXT NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (format_id, tag)
);
CREATE INDEX idx_tags_tag ON format_tags(tag);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'aruna',
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  profile TEXT NOT NULL,                      -- ModelProfile JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'aruna',
  format_id TEXT NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  variation_strength TEXT NOT NULL DEFAULT 'close',
  status TEXT NOT NULL DEFAULT 'draft',
  output TEXT NOT NULL,                       -- GenerationRun JSON (ideations[])
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gen_format ON generations(format_id);
CREATE INDEX idx_gen_profile ON generations(profile_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'aruna',
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload TEXT,
  result_format_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON jobs(status);
