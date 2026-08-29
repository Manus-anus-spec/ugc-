#!/usr/bin/env bash
# TEMPORARY: finish the rescore sweep, resilient to the two failure modes actually observed.
#
# FAILURE MODE 1 — Gemini 400 "User location is not supported for the API use." Cloudflare
# Workers egress from whichever colo serves the request (this account has been served from
# SIN), Gemini geolocates that egress IP, and from some colos it refuses outright. It is
# intermittent: 64 formats succeeded, then a whole batch failed, then it worked again on
# retry minutes later. So: back off and retry rather than stop.
#
# FAILURE MODE 2 — a run of "missing or invalid X-API-Key" with a key that works before and
# after. Cause still unproven. Re-read the key each batch and back off.
#
# LOOP BUG THIS FIXES: the previous version treated `rescored == 0` as "nothing left" and
# exited. Zero rescored with failures > 0 means the opposite — every row in the batch failed
# and there is more work to do. Only `remaining == 0` means done.
set -uo pipefail
cd /Users/mac/Desktop/ugc-/.claude/worktrees/phase1-tests-ci

API=https://ugc-api.khian-moclou.workers.dev
OUT=rescore_progress3.jsonl
: > "$OUT"
TOTAL=0
CONSEC_FAIL=0

for i in $(seq 1 40); do
  KEY=$(grep 'khian:' /Users/mac/Desktop/ugc-/SECRETS.local.md | grep -o '[a-f0-9]\{20,\}' | head -1)
  resp=$(curl -s -m 280 -X POST -H "X-API-Key: $KEY" "$API/admin/rescore-virality?limit=6" 2>/dev/null)

  if [ -z "$resp" ]; then
    echo "batch $i: EMPTY (curl timeout — worker may finish via waitUntil)"
    CONSEC_FAIL=$((CONSEC_FAIL+1)); sleep 30; continue
  fi
  echo "$resp" >> "$OUT"

  read -r count remaining nfail <<<"$(printf '%s' "$resp" | python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
    print(len(d.get('rescored',[])), d.get('remaining','?'), len(d.get('failures',[])))
except Exception: print(-1,'?',0)" 2>/dev/null)"

  if [ "$remaining" = "?" ]; then
    echo "batch $i: UNEXPECTED -> $(printf '%s' "$resp" | head -c 140)"
    CONSEC_FAIL=$((CONSEC_FAIL+1)); sleep 45; continue
  fi

  TOTAL=$((TOTAL + count))
  echo "batch $i: rescored $count (failed $nfail) | remaining $remaining | total $TOTAL"

  [ "$remaining" = "0" ] && { echo "ALL DONE"; break; }

  if [ "$count" = "0" ]; then
    CONSEC_FAIL=$((CONSEC_FAIL+1))
    if [ "$CONSEC_FAIL" -ge 6 ]; then echo "6 consecutive dead batches — stopping"; break; fi
    sleep 60   # location errors clear on their own; give it time
  else
    CONSEC_FAIL=0
    sleep 8
  fi
done
echo "SWEEP FINISHED — rescored $TOTAL this run"
