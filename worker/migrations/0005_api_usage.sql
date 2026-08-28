-- 0005 — per-operator daily call counters for the paid endpoints (§P2 hardening).
--
-- WHY: /analyze and /generate both spend real Gemini money and had no rate limiting of any
-- kind — only quota ERROR HANDLING, which fires after the money is gone. The endpoints are
-- auth-gated to two operators, so the risk is not abuse by strangers; it is that a leaked
-- token means UNCAPPED spend, and that an automation bug (a retry loop in a script) can
-- burn a month's budget before anyone looks at a dashboard.
--
-- Keyed by (operator, day, endpoint): a per-operator cap, so one operator's automation run
-- cannot starve the other, and per-endpoint because an analyze and a 3-ideation generate
-- cost different amounts and deserve separate ceilings.
--
-- `day` is a UTC date string (YYYY-MM-DD), not a rolling window. Deliberate: a daily reset
-- is what an operator can reason about ("I have 40 analyses left today") and it needs no
-- background job to prune. Rows are tiny and one per operator/endpoint/day.

CREATE TABLE IF NOT EXISTS api_usage (
  operator TEXT NOT NULL,
  day      TEXT NOT NULL,             -- UTC YYYY-MM-DD
  endpoint TEXT NOT NULL,             -- 'analyze' | 'generate'
  calls    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (operator, day, endpoint)
);

-- Reads are always by the full primary key, so no secondary index is needed.
