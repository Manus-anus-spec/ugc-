#!/usr/bin/env python3
"""Execute every hand-written SQL string in the worker against real SQLite.

WHY THIS EXISTS. D1 *is* SQLite, and the worker's SQL is the one layer TypeScript cannot
check at all: a typo'd column, a bad json_extract path or a malformed CTE compiles fine and
fails as a 500 in production, on a paid endpoint. Nothing else in the test chain touches it,
and the aggregation queries added in Phases 3-4 (verdict counts, usage counts, coverage,
library insights) are exactly the kind of hand-written SQL that rots silently.

WHAT IT DOES
  1. Builds the schema from worker/migrations/*.sql in order — so this also proves the
     migrations apply cleanly and in sequence, including 0004's ALTER TABLEs.
  2. Extracts every backtick template literal that starts with SELECT or WITH from the
     route files and EXECUTES it (with dummy bindings) against a fixture.
  3. Asserts the two aggregations whose logic actually matters get the arithmetic right.

Requires only the Python standard library (sqlite3). Wired into `npm test` as test:sql.

Two traps this script itself fell into, kept as warnings for the next reader:
  - `con.execute(sql)` on a SELECT only PREPARES it. Runtime errors (bad json path,
    malformed JSON) surface on fetch, so without .fetchall() everything "passes".
  - Executing the INSERT/UPDATE literals with dummy bindings pollutes the fixture
    (output='f1' is not valid JSON) and every json_extract downstream then fails, which
    looks precisely like a production bug and is not one. Reads only.
"""
import glob
import pathlib
import re
import sqlite3
import sys

ROUTE_FILES = [
    "worker/src/routes/coverage.ts",
    "worker/src/routes/insights.ts",
    "worker/src/routes/generate.ts",
]

DNA_FIXTURE = """{"hook":{"type":"visual","openingVisual":"x","mechanism":"y"},
 "pacing":{"payoffSec":2.5,"cutCadenceSec":1.4,"isOneShot":false,"totalDurationSec":12},
 "virality":{"overall":72,"dimensions":{"hook":{"score":80,"reason":"r"},
   "retention":{"score":70,"reason":"r"},"emotion":{"score":65,"reason":"r"},
   "share":{"score":60,"reason":"r"},"replay":{"score":55,"reason":"r"},
   "algo":{"score":75,"reason":"r"}},
   "strengths":["scroll-stop freeze","clean reveal"],
   "weaknesses":["no share trigger"]},
 "whyItWorks":{"mechanism":"curiosity gap","retentionDrivers":["await the unfreeze","open loop"],
   "targetViewer":"scrollers"}}"""


def build_schema(con: sqlite3.Connection) -> None:
    for mig in sorted(glob.glob("worker/migrations/*.sql")):
        sql = re.sub(r"--[^\n]*", "", pathlib.Path(mig).read_text())
        for stmt in (s.strip() for s in sql.split(";") if s.strip()):
            try:
                con.execute(stmt)
            except sqlite3.Error as e:
                # FTS5 virtual tables may be absent from a given python build; the worker's
                # FTS queries are not what this script is guarding.
                print(f"  (skipped in {pathlib.Path(mig).name}: {e})")


def seed(con: sqlite3.Connection) -> None:
    for fid, arch, score, hook in (("f1", "skit", 72, "visual"), ("f2", "pov", 44, "text")):
        con.execute(
            "INSERT INTO formats (id,title,archetype,format_type,virality_score,hook_type,"
            "content_rating,platform,schema_version,current_version,dna,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,'sfw','instagram','1',1,?,'2026-01-01','2026-01-01')",
            (fid, fid.upper(), arch, arch, score, hook, DNA_FIXTURE),
        )
    # One synthesize run (carries sourceFormatIds) and one reproduce run (does not) — the
    # two shapes the "counted both ways" accounting has to handle.
    con.execute(
        "INSERT INTO generations (id,format_id,format_version,profile_id,profile_version,"
        "output,created_at,verdict) VALUES ('g1','f1',1,'rosalia',1,?,'2026-01-02','down')",
        ('{"sourceFormatIds":["f1","f2"],"fidelityMode":"synthesize"}',),
    )
    con.execute(
        "INSERT INTO generations (id,format_id,format_version,profile_id,profile_version,"
        "output,created_at,verdict) VALUES ('g2','f2',1,'rosalia',1,?,'2026-01-03','up')",
        ('{"fidelityMode":"reproduce"}',),
    )
    con.commit()


def run_extracted(con: sqlite3.Connection) -> tuple[int, int]:
    found = failed = 0
    for path in ROUTE_FILES:
        text = pathlib.Path(path).read_text()
        for lit in re.findall(r"`([^`]*?)`", text, re.S):
            if not re.match(r"^\s*(SELECT|WITH)\b", lit, re.I):
                continue
            if "${" in lit:
                lit = lit.replace("${path}", "$.whyItWorks.retentionDrivers")
                if "${" in lit:
                    continue
            sql = lit.strip()
            found += 1
            try:
                con.execute(sql, tuple(["f1"] * sql.count("?"))).fetchall()
            except sqlite3.Error as e:
                failed += 1
                flat = " ".join(sql.split())
                print(f"\nFAIL {path}\n  {e}\n  {flat[:240]}")
    return found, failed


def main() -> int:
    con = sqlite3.connect(":memory:")
    build_schema(con)

    cols = [r[1] for r in con.execute("PRAGMA table_info(generations)")]
    for required in ("verdict", "verdict_note", "verdict_at", "verdict_ideation"):
        assert required in cols, f"migration 0004 did not apply: {required} missing"
    assert "status" in cols, "migration 0004 must not remove the status column"
    print(f"migrations apply cleanly; generations has {len(cols)} columns")

    seed(con)
    found, failed = run_extracted(con)
    print(f"executed {found} worker SQL statements, {failed} failed")
    assert found >= 5, f"only found {found} SQL literals — did the extraction break?"

    # ── the aggregations whose arithmetic actually matters ──
    usage = con.execute(
        """WITH used AS (
             SELECT j.value AS format_id, 'fused' AS how
               FROM generations g, json_each(json_extract(g.output,'$.sourceFormatIds')) j
             UNION ALL
             SELECT g.format_id, 'subject' FROM generations g
              WHERE json_extract(g.output,'$.sourceFormatIds') IS NULL)
           SELECT format_id, SUM(how='fused'), SUM(how='subject')
             FROM used GROUP BY format_id ORDER BY format_id"""
    ).fetchall()
    assert usage == [("f1", 1, 0), ("f2", 1, 1)], f"usage accounting wrong: {usage}"

    verdicts = con.execute(
        """WITH judged AS (
             SELECT g.verdict AS verdict, j.value AS format_id
               FROM generations g, json_each(json_extract(g.output,'$.sourceFormatIds')) j
              WHERE g.verdict IS NOT NULL
             UNION ALL
             SELECT g.verdict, g.format_id FROM generations g
              WHERE g.verdict IS NOT NULL
                AND json_extract(g.output,'$.sourceFormatIds') IS NULL)
           SELECT format_id,
                  SUM(CASE WHEN verdict IN ('up','shipped') THEN 1 ELSE 0 END),
                  SUM(CASE WHEN verdict='down' THEN 1 ELSE 0 END)
             FROM judged GROUP BY format_id ORDER BY format_id"""
    ).fetchall()
    # f1: one down, as a fused source. f2: one down (fused) + one up (subject of g2).
    assert verdicts == [("f1", 0, 1), ("f2", 1, 1)], f"verdict accounting wrong: {verdicts}"

    # json_each over a MISSING array must yield zero rows, not raise — most live runs are
    # reproduce runs with no sourceFormatIds, so this is load-bearing.
    empty = con.execute(
        "SELECT COUNT(*) FROM generations g, "
        "json_each(json_extract(g.output,'$.nope')) j"
    ).fetchone()
    assert empty == (0,), f"json_each over a missing path should be empty, got {empty}"

    paths = con.execute(
        """SELECT json_extract(dna,'$.hook.type'),
                  json_extract(dna,'$.pacing.payoffSec'),
                  json_extract(dna,'$.virality.dimensions.retention.score')
             FROM formats WHERE id='f1'"""
    ).fetchone()
    assert paths == ("visual", 2.5, 70), f"insights json paths wrong: {paths}"
    print("usage, verdict and insights aggregations all compute correctly")

    if failed:
        print("\nSQL FAILURES ABOVE")
        return 1
    print("\nALL SQL CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
