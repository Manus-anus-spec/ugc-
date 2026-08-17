#!/bin/bash
# Batch UGC Video Analyzer + Make for Sav Pipeline
# Uploads videos to UGC app, validates analysis, saves to library, runs Make for Sav

PROXY_URL="https://ugc-worker.khian-moclou.workers.dev"
LIBRARY_URL="https://sav-viral-scanner.khian-moclou.workers.dev"
VDIR="/Users/mac/Desktop/videos to recreate 21 "
LOG="/Users/mac/Desktop/ugc-/batch-log.json"
MAX_RETRIES=2
MIN_SECTIONS=10

echo "[]" > "$LOG"
echo "=== UGC Batch Analyzer ==="
echo "Videos dir: $VDIR"
echo "Proxy: $PROXY_URL"
echo "Library: $LIBRARY_URL"
echo ""

# Count videos
TOTAL=$(find "$VDIR" -maxdepth 1 -type f -name "*.mp4" | wc -l | tr -d ' ')
echo "Found $TOTAL videos to process"
echo ""

COUNT=0
SUCCESS=0
FAILED=0

process_video() {
  local filepath="$1"
  local filename=$(basename "$filepath")
  local attempt=1

  echo "[$COUNT/$TOTAL] Processing: $filename"

  while [ $attempt -le $MAX_RETRIES ]; do
    echo "  Attempt $attempt/$MAX_RETRIES — uploading to analyzer..."

    # Upload and analyze via the app's endpoint
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      --max-time 180 \
      -X POST "$PROXY_URL/analyze" \
      -F "video=@$filepath" \
      2>/dev/null)

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" != "200" ]; then
      echo "  ERROR: HTTP $HTTP_CODE"
      if [ $attempt -lt $MAX_RETRIES ]; then
        echo "  Retrying in 5s..."
        sleep 5
        attempt=$((attempt + 1))
        continue
      else
        echo "  FAILED after $MAX_RETRIES attempts"
        FAILED=$((FAILED + 1))
        return 1
      fi
    fi

    # Extract the analysis result
    ANALYSIS=$(echo "$BODY" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('result', ''))
except:
    print('')
" 2>/dev/null)

    if [ -z "$ANALYSIS" ]; then
      echo "  ERROR: Empty analysis"
      if [ $attempt -lt $MAX_RETRIES ]; then
        echo "  Retrying in 5s..."
        sleep 5
        attempt=$((attempt + 1))
        continue
      else
        FAILED=$((FAILED + 1))
        return 1
      fi
    fi

    # Count sections (## N. format)
    SECTION_COUNT=$(echo "$ANALYSIS" | grep -cE '^## [0-9]+\.')
    echo "  Analysis complete: $SECTION_COUNT sections found"

    if [ $SECTION_COUNT -lt $MIN_SECTIONS ]; then
      echo "  WARNING: Only $SECTION_COUNT sections (need $MIN_SECTIONS+)"
      if [ $attempt -lt $MAX_RETRIES ]; then
        echo "  Re-analyzing for better coverage..."
        sleep 3
        attempt=$((attempt + 1))
        continue
      else
        echo "  Using best analysis available ($SECTION_COUNT sections)"
      fi
    fi

    # Detect format type, extract hooks, prompts
    ITEM_ID=$(date +%s%N | cut -c1-13)

    SAVE_RESULT=$(echo "$ANALYSIS" | python3 -c "
import json, sys, re

analysis = sys.stdin.read()

# Detect format
lower = analysis.lower()
if 'gray beard' in lower or 'gray hair' in lower or 'older men' in lower or 'older guys' in lower or 'icp' in lower or 'mature men' in lower:
    fmt = 'ICP Targeting'
elif ('before' in lower and 'after' in lower) or 'transformation' in lower or 'transition' in lower:
    fmt = 'Transformation'
elif 'danc' in lower or 'trending audio' in lower or 'choreograph' in lower:
    fmt = 'Dancing/Motion'
elif 'gym' in lower or 'workout' in lower or 'fitness' in lower:
    fmt = 'General Lifestyle'
else:
    fmt = 'General Lifestyle'

# Extract hook
hook = 'No hook extracted'
for pat in [r'\*\*Visual Hook:\*\*\s*(.+)', r'\*\*Would You Stop Scrolling:\*\*\s*(.+)', r'\*\*Hook:\*\*\s*(.+)', r'\*\*First Frame:\*\*\s*(.+)']:
    m = re.search(pat, analysis)
    if m:
        hook = m.group(1).strip().strip('\"\'')
        break

# Extract prompts from code blocks
blocks = re.findall(r'\`\`\`[\w-]*\n([\s\S]*?)\`\`\`', analysis)
nb_prompt = blocks[0].strip() if len(blocks) >= 1 else ''
kling_prompt = blocks[1].strip() if len(blocks) >= 2 else ''

# Video meta
section1 = ''
s1_match = re.search(r'## 1\.([\s\S]*?)(?=## 2\.|$)', analysis)
if s1_match:
    section1 = s1_match.group(0)
s1_lower = section1.lower()
is_one_shot = 'one shot' in s1_lower or 'single shot' in s1_lower or ('multi' not in s1_lower and 'edited' not in s1_lower)
dur_match = re.search(r'\*\*(?:Total )?Duration:\*\*\s*[~]?(\d+[\s-]*\d*)\s*(?:seconds|s\b)', section1, re.I)
duration = (dur_match.group(1).strip() + 's') if dur_match else ''
cuts_match = re.search(r'\*\*(?:Number of )?Cuts:\*\*\s*(\d+)', section1, re.I)
clip_count = int(cuts_match.group(1)) + 1 if cuts_match else (1 if is_one_shot else 0)

item = {
    'id': '$ITEM_ID',
    'savedAt': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'formatType': fmt,
    'hookText': hook[:200],
    'fullAnalysis': analysis,
    'nbPrompt': nb_prompt,
    'klingPrompt': kling_prompt,
    'isOneShot': is_one_shot,
    'duration': duration,
    'clipCount': clip_count,
}
print(json.dumps(item))
" 2>/dev/null)

    if [ -z "$SAVE_RESULT" ]; then
      echo "  ERROR: Failed to parse analysis"
      FAILED=$((FAILED + 1))
      return 1
    fi

    # Save to library
    echo "  Saving to library..."
    SAVE_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "$LIBRARY_URL/library" \
      -H "Content-Type: application/json" \
      -d "$SAVE_RESULT" 2>/dev/null)

    if [ "$SAVE_HTTP" = "200" ] || [ "$SAVE_HTTP" = "201" ]; then
      echo "  Saved to library (ID: $ITEM_ID)"
    else
      echo "  WARNING: Library save returned HTTP $SAVE_HTTP"
    fi

    # Run Make for Sav
    echo "  Running Make for Sav..."
    SAV_RESPONSE=$(curl -s --max-time 120 \
      -X POST "$LIBRARY_URL/generate-sav-idea" \
      -H "Content-Type: application/json" \
      -d "{\"item\": $SAVE_RESULT}" 2>/dev/null)

    SAV_ERROR=$(echo "$SAV_RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if 'error' in data:
        print(data['error'][:100])
    else:
        print('OK')
except:
    print('PARSE_ERROR')
" 2>/dev/null)

    if [ "$SAV_ERROR" = "OK" ]; then
      # Merge savPrompts into item and re-save
      MERGED=$(python3 -c "
import json, sys
item = json.loads('''$SAVE_RESULT''')
sav = json.loads('''$SAV_RESPONSE''')
item['savPrompts'] = sav
print(json.dumps(item))
" 2>/dev/null)

      if [ -n "$MERGED" ]; then
        curl -s -o /dev/null -X POST "$LIBRARY_URL/library" \
          -H "Content-Type: application/json" \
          -d "$MERGED" 2>/dev/null
        echo "  Make for Sav: SUCCESS"

        # Extract key info for log
        MODEL=$(echo "$SAV_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('videoModel','?'))" 2>/dev/null)
        FORMAT=$(echo "$SAV_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('videoFormat','?'))" 2>/dev/null)
        echo "  Model: $MODEL | Format: $FORMAT"
      fi
    else
      echo "  Make for Sav: FAILED ($SAV_ERROR)"
      echo "  (Item saved to library — can retry Make for Sav from the app)"
    fi

    # Log result
    python3 -c "
import json
log = json.load(open('$LOG'))
log.append({'id': '$ITEM_ID', 'file': '$filename', 'sections': $SECTION_COUNT, 'sav': '$SAV_ERROR' == 'OK'})
json.dump(log, open('$LOG', 'w'), indent=2)
" 2>/dev/null

    SUCCESS=$((SUCCESS + 1))
    echo "  DONE"
    echo ""
    return 0
  done
}

# Process each video
find "$VDIR" -maxdepth 1 -type f -name "*.mp4" | sort | while read filepath; do
  COUNT=$((COUNT + 1))
  process_video "$filepath"
  # Pause between videos to avoid rate limiting
  sleep 2
done

echo "=== COMPLETE ==="
echo "Total: $TOTAL | Success: $SUCCESS | Failed: $FAILED"
echo "Log: $LOG"
echo ""
echo "Next: Check library at $LIBRARY_URL/library"
echo "Then generate videos from items with savPrompts"
