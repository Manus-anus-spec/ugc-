#!/usr/bin/env bash
# 🔑 Khian runs this (needs wrangler + network). Snapshots a KV namespace to JSON —
# both migration input and cold backup (FABLE5-PLAN Phase 0.3 / Phase 1.3).
#
# Usage:
#   ./scripts/kv-snapshot.sh <namespace-id> <outfile.json>
#
# Find namespace ids:   wrangler kv namespace list
#   LIBRARY          → sav-content-library's namespace (primary migration source)
#   FORMAT_LIBRARY   → sav-viral-scanner's app-library namespace (backup only)
set -euo pipefail

NS_ID="${1:?usage: kv-snapshot.sh <namespace-id> <outfile.json>}"
OUT="${2:?usage: kv-snapshot.sh <namespace-id> <outfile.json>}"

echo "Listing keys in namespace $NS_ID …"
KEYS=$(wrangler kv key list --namespace-id="$NS_ID" | node -e '
  let d = ""; process.stdin.on("data", c => d += c);
  process.stdin.on("end", () => {
    for (const k of JSON.parse(d)) console.log(k.name);
  });
')

echo "{" > "$OUT"
FIRST=1
while IFS= read -r KEY; do
  [ -z "$KEY" ] && continue
  echo "  fetching: $KEY"
  VAL=$(wrangler kv key get --namespace-id="$NS_ID" "$KEY" 2>/dev/null || echo "null")
  if [ "$FIRST" -eq 0 ]; then echo "," >> "$OUT"; fi
  FIRST=0
  node -e '
    const [key, val] = [process.argv[1], process.argv[2]];
    let parsed; try { parsed = JSON.parse(val); } catch { parsed = val; }
    process.stdout.write(JSON.stringify(key) + ": " + JSON.stringify(parsed));
  ' "$KEY" "$VAL" >> "$OUT"
done <<< "$KEYS"
echo "" >> "$OUT"
echo "}" >> "$OUT"

echo "Snapshot written to $OUT ($(wc -c < "$OUT") bytes)"
