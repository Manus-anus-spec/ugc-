-- 0004 — operator feedback on a generation run (Phase 3, 2026-08-28).
--
-- WHY A NEW COLUMN INSTEAD OF REUSING `status`:
-- `status` is the PIPELINE axis (draft|approved|produced) and `verdict` is the QUALITY
-- axis (up|down|shipped). Merging them would force one vocabulary to absorb the other and
-- make "approved but bad" or "shipped and terrible" unrepresentable. Two clean axes, no
-- collision. The existing `status` column is deliberately left exactly as it is — every
-- one of the 138 pre-existing rows keeps status='draft' and simply has a NULL verdict.
--
-- All columns are nullable with no default, so this migration is non-destructive and
-- backwards-compatible: existing rows read as "never judged", which is the truth.
--
-- NOTE on verdict_ideation: the locked decision named three columns (verdict,
-- verdict_note, verdict_at). This adds a fourth, because the agreed PATCH contract
-- accepts an `ideationIndex` — a run holds 3 ideation cards and the operator judges one
-- of them. The alternative was packing the index into verdict_note as text, which would
-- put structured data in a free-text field. Additive and still nullable; `status` remains
-- untouched, which was the substance of the decision.

ALTER TABLE generations ADD COLUMN verdict TEXT;            -- 'up' | 'down' | 'shipped'
ALTER TABLE generations ADD COLUMN verdict_note TEXT;       -- optional operator comment
ALTER TABLE generations ADD COLUMN verdict_at TEXT;         -- ISO timestamp of the judgement
ALTER TABLE generations ADD COLUMN verdict_ideation INTEGER;-- which ideation index was judged

-- The fitness aggregate in the surprise sampler filters on `verdict IS NOT NULL` on every
-- synthesis draw; without this index that is a full scan of the generations table.
CREATE INDEX IF NOT EXISTS idx_gen_verdict ON generations(verdict);
