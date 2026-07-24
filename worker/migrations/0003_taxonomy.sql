-- v2 taxonomy + virality: filterable canonical format type and the brutal score,
-- denormalized from the DNA JSON for cheap library filtering/sorting.
ALTER TABLE formats ADD COLUMN format_type TEXT;
ALTER TABLE formats ADD COLUMN virality_score INTEGER;

-- Backfill from any DNA that already carries the v2 fields (older rows stay NULL —
-- they predate the scorecard; re-analyze to score them).
UPDATE formats
SET format_type = json_extract(dna, '$.formatType'),
    virality_score = CAST(json_extract(dna, '$.virality.overall') AS INTEGER)
WHERE schema_version = '1';

CREATE INDEX IF NOT EXISTS idx_formats_format_type ON formats (format_type);
