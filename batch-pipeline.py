#!/usr/bin/env python3
"""
Batch UGC Pipeline — Analyze → Save → Make for Sav
Processes all videos in the target folder automatically.
"""
import os, json, time, re, sys, subprocess, requests
from datetime import datetime, timezone

# --- Config ---
PROXY_URL = "https://ugc-worker.khian-moclou.workers.dev"
LIBRARY_URL = "https://sav-viral-scanner.khian-moclou.workers.dev"
CONTENT_LIBRARY_URL = "https://sav-content-library.khian-moclou.workers.dev"
VIDEO_DIR = "/Users/mac/Desktop/videos to recreate 21 "
LOG_FILE = "/Users/mac/Desktop/ugc-/batch-results.json"
MIN_SECTIONS = 10
MAX_RETRIES = 2
ANALYZE_TIMEOUT = 180
SAV_TIMEOUT = 120

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def count_sections(analysis):
    """Count ## N. sections in analysis markdown."""
    return len(re.findall(r'^## \d+\.', analysis, re.MULTILINE))

def extract_hook(analysis):
    patterns = [
        r'\*\*Visual Hook:\*\*\s*(.+)',
        r'\*\*Would You Stop Scrolling:\*\*\s*(.+)',
        r'\*\*Pattern Interrupt:\*\*\s*(.+)',
        r'\*\*Hook:\*\*\s*(.+)',
        r'\*\*First Frame:\*\*\s*(.+)',
    ]
    for pat in patterns:
        m = re.search(pat, analysis)
        if m:
            return m.group(1).strip().strip('"\'')[:200]
    return "No hook extracted"

def detect_format(analysis):
    lower = analysis.lower()
    if any(w in lower for w in ['gray beard','gray hair','older men','older guys','mature men','hiring a boyfriend']):
        return 'ICP Targeting'
    if any(w in lower for w in ['transformation','transition','before','outfit reveal']):
        return 'Transformation'
    if any(w in lower for w in ['danc','trending audio','choreograph','motion control']):
        return 'Dancing/Motion'
    if any(w in lower for w in ['gym','workout','fitness']):
        return 'General Lifestyle'
    if any(w in lower for w in ['comment','poll','choose','binary']):
        return 'Comment Farming'
    return 'General Lifestyle'

def extract_video_meta(analysis):
    s1_match = re.search(r'## [01]\.([\s\S]*?)(?=## [12]\.)', analysis)
    section = s1_match.group(0) if s1_match else ''
    s_lower = section.lower()
    is_one = 'one shot' in s_lower or 'single shot' in s_lower or ('multi' not in s_lower and 'edited' not in s_lower)
    dur_m = re.search(r'\*\*(?:Total )?Duration:\*\*\s*~?(\d+[\s-]*\d*)\s*(?:seconds|s\b)', section, re.I)
    duration = (dur_m.group(1).strip() + 's') if dur_m else ''
    cuts_m = re.search(r'\*\*(?:Number of )?Cuts:\*\*\s*(\d+)', section, re.I)
    clips = int(cuts_m.group(1)) + 1 if cuts_m else (1 if is_one else 0)
    return is_one, duration, clips

def extract_prompts(analysis):
    blocks = re.findall(r'```[\w-]*\n([\s\S]*?)```', analysis)
    nb = blocks[0].strip() if len(blocks) >= 1 else ''
    kling = blocks[1].strip() if len(blocks) >= 2 else ''
    return nb, kling

def analyze_video(filepath):
    """Upload video to UGC app analysis endpoint."""
    filename = os.path.basename(filepath)
    with open(filepath, 'rb') as f:
        files = {'video': (filename, f, 'video/mp4')}
        resp = requests.post(f"{PROXY_URL}/analyze", files=files, timeout=ANALYZE_TIMEOUT)

    if resp.status_code != 200:
        try:
            err = resp.json().get('error', resp.text[:200])
        except:
            err = resp.text[:200]
        return None, f"HTTP {resp.status_code}: {err}"

    data = resp.json()
    if 'error' in data:
        return None, data['error'][:200]

    result = data.get('result', '')
    if not result:
        return None, "Empty analysis"

    return result, None

def save_to_library(item):
    """Save item to the viral scanner library."""
    resp = requests.post(f"{LIBRARY_URL}/library", json=item, timeout=30)
    return resp.status_code in (200, 201)

def push_to_content_library(item):
    """Push to content library (non-blocking)."""
    try:
        sav = item.get('savPrompts', {})
        payload = {
            'id': f"UGC-{item['id']}",
            'name': item.get('hookText', ''),
            'source_url': item.get('sourceUrl', ''),
            'category': item.get('formatType', ''),
            'tags': [item.get('formatType', '')],
            'nb_prompt': sav.get('nbPrompt', item.get('nbPrompt', '')),
            'sd_prompt': sav.get('sdPrompt', ''),
            'kling_prompt': sav.get('videoPrompt', '') or sav.get('klingPrompt', '') or item.get('klingPrompt', ''),
            'hook_analysis': item.get('hookText', ''),
            'caption_options': [sav['caption']] if sav.get('caption') else [],
            'raw': {
                'fullAnalysis': item.get('fullAnalysis', ''),
                'formatType': item.get('formatType', ''),
                'textOverlays': sav.get('textOverlays', []),
                'whyItWorks': sav.get('whyItWorks', ''),
                'creativeBrief': sav.get('creativeBrief', ''),
                'videoModel': sav.get('videoModel', ''),
                'videoFormat': sav.get('videoFormat', ''),
                'productionBrief': sav.get('productionBrief', []),
                'audioPlan': sav.get('audioPlan'),
                'editingNotes': sav.get('editingNotes', ''),
            },
        }
        requests.post(f"{CONTENT_LIBRARY_URL}/add", json=payload, timeout=30)
    except Exception as e:
        log(f"  Content library push failed (non-blocking): {e}")

def make_for_sav(item):
    """Run Make for Sav via the generate-sav-idea endpoint."""
    resp = requests.post(
        f"{LIBRARY_URL}/generate-sav-idea",
        json={'item': item},
        timeout=SAV_TIMEOUT
    )

    if resp.status_code != 200:
        try:
            err = resp.json().get('error', resp.text[:200])
        except:
            err = resp.text[:200]
        return None, f"HTTP {resp.status_code}: {err}"

    data = resp.json()
    if 'error' in data:
        return None, data['error'][:200]

    return data, None

def process_video(filepath, index, total):
    """Full pipeline for one video: analyze → save → make for sav."""
    filename = os.path.basename(filepath)
    log(f"[{index}/{total}] {filename}")

    # Step 1: Analyze (with retries)
    best_analysis = None
    best_sections = 0

    for attempt in range(1, MAX_RETRIES + 1):
        log(f"  Analyze attempt {attempt}/{MAX_RETRIES}...")
        analysis, err = analyze_video(filepath)

        if err:
            log(f"  ERROR: {err}")
            if attempt < MAX_RETRIES:
                log(f"  Retrying in 5s...")
                time.sleep(5)
                continue
            else:
                if best_analysis:
                    log(f"  Using best analysis ({best_sections} sections)")
                    analysis = best_analysis
                else:
                    log(f"  FAILED after {MAX_RETRIES} attempts")
                    return {'file': filename, 'status': 'failed', 'error': err}

        if analysis:
            sections = count_sections(analysis)
            log(f"  Got {sections} sections ({len(analysis)} chars)")

            if sections > best_sections:
                best_analysis = analysis
                best_sections = sections

            if sections >= MIN_SECTIONS:
                break
            elif attempt < MAX_RETRIES:
                log(f"  Only {sections} sections, re-analyzing...")
                time.sleep(3)

    analysis = best_analysis
    if not analysis:
        return {'file': filename, 'status': 'failed', 'error': 'No analysis produced'}

    # Step 2: Build library item
    item_id = str(int(time.time() * 1000))
    is_one, duration, clips = extract_video_meta(analysis)
    nb_prompt, kling_prompt = extract_prompts(analysis)

    item = {
        'id': item_id,
        'savedAt': datetime.now(timezone.utc).isoformat(),
        'formatType': detect_format(analysis),
        'hookText': extract_hook(analysis),
        'fullAnalysis': analysis,
        'nbPrompt': nb_prompt,
        'klingPrompt': kling_prompt,
        'isOneShot': is_one,
        'duration': duration,
        'clipCount': clips,
    }

    # Step 3: Save to library
    log(f"  Saving to library (ID: {item_id})...")
    if save_to_library(item):
        log(f"  Library save: OK")
    else:
        log(f"  Library save: FAILED (continuing)")

    # Step 4: Make for Sav
    log(f"  Running Make for Sav...")
    sav_prompts, sav_err = make_for_sav(item)

    if sav_prompts:
        item['savPrompts'] = sav_prompts
        # Re-save with Sav prompts
        save_to_library(item)
        push_to_content_library(item)

        model = sav_prompts.get('videoModel', '?')
        fmt = sav_prompts.get('videoFormat', '?')
        dur = sav_prompts.get('videoDuration', '?')
        log(f"  Make for Sav: OK — Model: {model} | Format: {fmt} | Duration: {dur}s")
    else:
        log(f"  Make for Sav: FAILED ({sav_err})")
        log(f"  (Item saved — can retry from the app)")

    result = {
        'file': filename,
        'id': item_id,
        'status': 'complete' if sav_prompts else 'partial',
        'sections': best_sections,
        'format': item['formatType'],
        'hook': item['hookText'][:60],
        'videoModel': sav_prompts.get('videoModel') if sav_prompts else None,
        'hasSav': sav_prompts is not None,
    }

    log(f"  DONE — {result['format']} | {result['hook']}")
    log("")
    return result

def main():
    log("=== UGC Batch Pipeline ===")
    log(f"Video dir: {VIDEO_DIR}")
    log(f"Min sections: {MIN_SECTIONS}")
    log("")

    # Find all videos
    videos = sorted([
        os.path.join(VIDEO_DIR, f)
        for f in os.listdir(VIDEO_DIR)
        if f.lower().endswith(('.mp4', '.mov', '.webm')) and not f.startswith('.')
    ])

    total = len(videos)
    log(f"Found {total} videos to process")
    log("")

    results = []
    success = 0
    failed = 0
    partial = 0

    for i, filepath in enumerate(videos, 1):
        result = process_video(filepath, i, total)
        results.append(result)

        if result['status'] == 'complete':
            success += 1
        elif result['status'] == 'partial':
            partial += 1
        else:
            failed += 1

        # Save progress after each video
        with open(LOG_FILE, 'w') as f:
            json.dump({
                'started': datetime.now(timezone.utc).isoformat(),
                'total': total,
                'processed': i,
                'success': success,
                'partial': partial,
                'failed': failed,
                'results': results,
            }, f, indent=2)

        # Pause between videos
        if i < total:
            time.sleep(3)

    log("=== PIPELINE COMPLETE ===")
    log(f"Total: {total} | Success: {success} | Partial: {partial} | Failed: {failed}")
    log(f"Results: {LOG_FILE}")
    log("")
    log("Check library: https://manus-anus-spec.github.io/ugc-/")

if __name__ == '__main__':
    main()
