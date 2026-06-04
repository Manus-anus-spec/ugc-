/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Video,
  FileText,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  RefreshCcw,
  ArrowRight,
  BookmarkPlus,
  Library,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Tag,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Config ---
const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://ugc-worker.khian-moclou.workers.dev';
const LIBRARY_URL = 'https://sav-viral-scanner.khian-moclou.workers.dev';

// --- Types ---
interface LibraryItem {
  id: string;
  savedAt: string;
  sourceUrl?: string;
  formatType: string;
  hookText: string;
  fullAnalysis: string;
  nbPrompt: string;
  klingPrompt: string;
  savPrompts?: SavPrompts;
}

interface SavPrompts {
  nbPrompt: string;
  sdPrompt?: string;
  klingPrompt: string;
  textOverlays: string[];
  caption: string;
  formulaExtracted?: string;
  whyItWorks?: string;
  creativeBrief?: string;
}

// --- Library API (Cloudflare KV via sav-viral-scanner worker) ---
async function apiFetchLibrary(): Promise<LibraryItem[]> {
  const res = await fetch(`${LIBRARY_URL}/library`);
  if (!res.ok) throw new Error('Failed to load library');
  const data = await res.json() as LibraryItem[];
  return Array.isArray(data) ? data : [];
}

async function apiSaveItem(item: LibraryItem): Promise<void> {
  const res = await fetch(`${LIBRARY_URL}/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('Failed to save item');
}

async function apiDeleteItem(id: string): Promise<void> {
  const res = await fetch(`${LIBRARY_URL}/library/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete item');
}

async function apiGenerateSavIdea(analysis: string): Promise<SavPrompts> {
  const res = await fetch(`${LIBRARY_URL}/generate-sav-idea`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Failed to generate Sav idea');
  }
  const data = await res.json() as {
    formulaExtracted?: string;
    whyItWorks?: string;
    creativeBrief?: string;
    nbPrompt?: string;
    sdPrompt?: string;
    klingPrompt?: string;
    textOverlays?: string[];
    caption?: string;
  };
  return {
    nbPrompt: data.nbPrompt || '',
    sdPrompt: data.sdPrompt || '',
    klingPrompt: data.klingPrompt || '',
    textOverlays: data.textOverlays || [],
    caption: data.caption || '',
    formulaExtracted: data.formulaExtracted,
    whyItWorks: data.whyItWorks,
    creativeBrief: data.creativeBrief,
  };
}

// --- Analysis Helpers ---
function extractSection(markdown: string, sectionNum: number): string {
  const regex = new RegExp(`## ${sectionNum}\\.([\\s\\S]*?)(?=## ${sectionNum + 1}\\.|$)`);
  const match = markdown.match(regex);
  return match ? match[0].trim() : '';
}

function extractNBPrompt(analysis: string): string {
  const match = analysis.match(/```nano-banana\n([\s\S]*?)```/);
  if (match) return match[1].trim();
  const section7 = extractSection(analysis, 7);
  const codeMatch = section7.match(/```[\w-]*\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : '';
}

function extractKlingPrompt(analysis: string): string {
  const allBlocks = [...analysis.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];
  if (allBlocks.length >= 2) return allBlocks[1][1].trim();
  if (allBlocks.length === 1) return allBlocks[0][1].trim();
  return '';
}

function extractHookText(analysis: string): string {
  const section10 = extractSection(analysis, 10);
  const match = section10.match(/\*\*Visual Hook:\*\*\s*(.+)/);
  if (match) return match[1].trim();
  const scrollMatch = section10.match(/\*\*Would You Stop Scrolling:\*\*\s*(.+)/);
  return scrollMatch ? scrollMatch[1].trim() : 'No hook extracted';
}

function detectFormatType(analysis: string): string {
  const lower = analysis.toLowerCase();
  if (lower.includes('gray beard') || lower.includes('older men') || lower.includes('hiring a boyfriend') || lower.includes('icp')) return 'ICP Targeting';
  if (lower.includes('before') && lower.includes('after') || lower.includes('transformation') || lower.includes('transition reel')) return 'Transformation';
  if (lower.includes("he's not controlling") || lower.includes('protecting') || lower.includes('pick-me') || lower.includes('pick me')) return 'Pick-Me Static';
  if (lower.includes('dirty talk') || lower.includes('kinky') || lower.includes('suggestive talk')) return 'Dirty Talking';
  if (lower.includes('send this to') || lower.includes('tag the') || lower.includes('share farming')) return 'Share Farming';
  if (lower.includes('choose one') || lower.includes('binary choice') || lower.includes('poll') || lower.includes('comment') && lower.includes('farming')) return 'Comment Farming';
  if (lower.includes('danc') || lower.includes('trending audio') || lower.includes('motion control')) return 'Dancing/Motion';
  if (lower.includes('controver') || lower.includes('unpopular opinion')) return 'Controversial Static';
  return 'General Lifestyle';
}

// --- Sav Prompt Generator ---
const FORMAT_OVERLAYS: Record<string, string[]> = {
  'ICP Targeting': [
    'men with gray hair make me crazy and i genuinely cannot explain it',
    'hiring: must be older, stable, and not need constant reassurance',
    'something about a man who has actually lived a little does things to me',
  ],
  'Pick-Me Static': [
    "if your man says dont go there / he's not controlling you / he's protecting what he loves",
    "a man who checks in on you isn't insecure / he knows what he has",
    "women who say they don't need a protector have never had one",
  ],
  'Transformation': [
    'on duty vs off duty 🌙',
    'what they see on the plane vs what they dont 🌙',
    'the uniform comes off eventually',
  ],
  'Comment Farming': [
    'your house is on fire, you can only save one: me, your dog, $67M, or your ps5',
    'pick one for 24 hours: private jet, 5-star hotel, or me as your flight attendant',
    'be honest in the comments — what are you picking',
  ],
  'Share Farming': [
    'send this to the one you\'re thinking about 🌙',
    'if someone sent you this, they\'re thinking about you',
    'tag the guy who deserves this on his next flight',
  ],
  'Dirty Talking': [
    'things i think about at 30,000 feet 🌙',
    'i have a confession about what i do on layovers',
    'the things i dont say on the plane',
  ],
  'Dancing/Motion': [
    'layover energy 🌙',
    'off duty finally',
    'what 14 hours in the air does to you',
  ],
  'Controversial Static': [
    'unpopular opinion: im standing on it',
    'say it louder for the ones in the back',
    'the comments are going to be interesting',
  ],
  'General Lifestyle': [
    'life at 30,000 feet 🌙',
    'what they dont show you about being a flight attendant',
    'another city, another layover',
  ],
};

const FORMAT_CAPTIONS: Record<string, string> = {
  'ICP Targeting': 'you know who you are 🌙',
  'Pick-Me Static': 'unpopular opinion but im standing on it',
  'Transformation': 'before and after a long haul 🌙',
  'Comment Farming': 'be honest in the comments',
  'Share Farming': 'send it 🌙',
  'Dirty Talking': 'i almost didnt post this',
  'Dancing/Motion': 'layover mode activated 🌙',
  'Controversial Static': 'the comments are going to be something',
  'General Lifestyle': 'just another layover 🌙',
};

const SAV_NB_RULES = `Match the uploaded reference image face exactly — do not alter facial features, face shape, skin tone, freckles, or hair. No under-eye bags, no eye creases, no forehead lines, no nasolabial folds. Zero signs of aging. NOT professional photography. No phone visible in frame, no device in hand. She is completely alone. No other person, no figure visible anywhere in frame or mirror reflection.`;

function buildSavNBPrompt(rawNB: string): string {
  let prompt = rawNB;
  // Strip conflicting character description language
  prompt = prompt.replace(/\b(brunette|redhead|dark hair|light hair|brown eyes|blue eyes|green eyes|pale skin|dark skin|tan skin|age\s+\d+|in her \d+s)[^.]*\./gi, '');
  // Ensure opening
  if (!prompt.toLowerCase().startsWith('refer to the girl')) {
    prompt = 'Refer to the girl in the reference images. ' + prompt;
  }
  // Ensure Raw iPhone aesthetic
  if (!prompt.toLowerCase().includes('raw iphone')) {
    prompt = prompt.replace('Refer to the girl in the reference images.', 'Refer to the girl in the reference images. Raw iPhone footage aesthetic.');
  }
  // Replace or append Sav rules
  if (prompt.includes('NOT professional photography')) {
    // Already has closer — replace from that point
    prompt = prompt.replace(/NOT professional photography[\s\S]*$/, SAV_NB_RULES);
  } else {
    prompt = prompt.trim() + ' ' + SAV_NB_RULES;
  }
  return prompt.trim();
}

function buildSavKlingPrompt(rawKling: string): string {
  if (!rawKling) return '';
  // Ensure the static camera header
  if (!rawKling.toLowerCase().includes('static locked-off')) {
    return 'Shot on iPhone front-facing camera, static locked-off camera, no camera movement, no zoom, no pan, no tilt. ' + rawKling;
  }
  return rawKling;
}

function generateSavPrompts(item: LibraryItem): SavPrompts {
  return {
    nbPrompt: buildSavNBPrompt(item.nbPrompt),
    klingPrompt: buildSavKlingPrompt(item.klingPrompt),
    textOverlays: FORMAT_OVERLAYS[item.formatType] || FORMAT_OVERLAYS['General Lifestyle'],
    caption: FORMAT_CAPTIONS[item.formatType] || FORMAT_CAPTIONS['General Lifestyle'],
  };
}

// --- Format Type Badge Colors ---
const FORMAT_COLORS: Record<string, string> = {
  'ICP Targeting': 'bg-purple-100 text-purple-800 border-purple-200',
  'Pick-Me Static': 'bg-pink-100 text-pink-800 border-pink-200',
  'Transformation': 'bg-blue-100 text-blue-800 border-blue-200',
  'Comment Farming': 'bg-orange-100 text-orange-800 border-orange-200',
  'Share Farming': 'bg-green-100 text-green-800 border-green-200',
  'Dirty Talking': 'bg-red-100 text-red-800 border-red-200',
  'Dancing/Motion': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Controversial Static': 'bg-gray-100 text-gray-800 border-gray-200',
  'General Lifestyle': 'bg-teal-100 text-teal-800 border-teal-200',
};

// --- Constants ---
const SYSTEM_INSTRUCTION = `You are a UGC Video Reverse-Engineering Analyst. Your job is to watch a reference video and output a precise, structured breakdown that a creator can use to recreate the video using AI tools (still image generation + image-to-video).

When analyzing the video, return the following sections EXACTLY:

## 1. VIDEO FORMAT
- **Type:** [ONE SHOT OR EDITED MULTI-CLIP]
- **Total Duration:** [estimated seconds]
- **Number of Cuts:** [count]
- **If Multi-Clip:** List each clip with timestamps and duration

## 2. CAMERA & FRAMING
- **Device Feel:** [describe vibe]
- **Orientation:** [9:16 / 16:9 / 1:1]
- **Camera Position:** [selfie/rear/propped/held]
- **Framing:** [close-up/waist up/etc]
- **Camera Height:** [eye level/above/below]
- **Camera Movement:** [static/handheld/pan/zoom]
- **If Static:** Note micro-movements

## 3. ENVIRONMENT
- **Location:** [be specific]
- **Lighting:** [describe sources]
- **Key Props/Objects Visible:** [list everything]
- **Color Palette:** [dominant colors]
- **Mood of Space:** [cozy/minimal/etc]

## 4. CHARACTER DESCRIPTION
- **Appearance:** [hair/skin/age]
- **Outfit:** [exact description]
- **Makeup/Grooming:** [be specific]
- **Overall Vibe:** [casual/glam/etc]

## 5. ACTION BREAKDOWN
For ONE SHOT: Table with Timestamp, Action, Duration, Hands Doing, Expression/Energy.
For MULTI-CLIP: Breakdown per clip with Action, Hands, Energy, Camera.

## 6. ENERGY & PACING
- **Overall Energy:** [calm/high/etc]
- **Pacing:** [rhythm description]
- **Transitions Between Actions:** [flow description]

## 7. READY-TO-USE PROMPTS

### A. NANO BANANA IMAGE PROMPT (Exact Scene Recreation)
Write a highly detailed image generation prompt that recreates the EXACT frame from the reference video. The user will provide their own character reference image — your prompt needs to nail everything AROUND and ABOUT the scene so the character drops into a perfect match.

NANO BANANA PROMPT MUST INCLUDE (in this order):
1. AESTHETIC OPENER: "Raw iPhone footage aesthetic" — always first
2. CAMERA SPECS: Orientation (9:16), camera height (below eye level, eye level, above), distance (arm's length selfie, 3ft away, across room), angle (straight-on, tilted left 5 degrees, off-axis), lens feel (slight wide-angle distortion from phone, or flat)
3. FRAMING: Exactly what's visible — "head to mid-thigh", "full body with 6 inches of floor visible", "shoulders up tight crop" — match the reference precisely
4. CHARACTER PLACEMENT: Where in frame — "centered", "slightly left of center", "right third" — and body orientation — "facing camera directly", "quarter turn to the left", "angled 30 degrees right with head turned to camera"
5. CHARACTER ACTION: What they're physically doing in this FROZEN MOMENT — "right hand mid-reach holding a makeup brush to her cheekbone, left hand holding a compact mirror at chest height" — be extremely specific about hand positions and what they're holding
6. OUTFIT (FULL DETAIL): Every garment visible — fabric type, fit, color, texture, how it sits on the body. Match the reference exactly.
7. ENVIRONMENT (FULL DETAIL): Describe EVERYTHING visible in the background and surroundings. Wall color/texture, furniture, objects, window placement, floor type, decorations, products, plants, props.
8. LIGHTING (DETAILED): Light source direction, quality, color temperature.
9. COLOR GRADE / MOOD: Overall tone of the image (e.g., "Warm muted tones, slightly desaturated").
10. TEXTURE & QUALITY: "Slight grain visible, soft focus on background, sharp on face and hands, natural skin texture visible — pores, tiny imperfections, not airbrushed"
11. CLOSER: "Ultra-realistic. NOT professional photography. No phones visible in frame. No recording devices. No text overlays. No UI elements."

OUTPUT FORMAT: Wrap the entire prompt in a code block labeled \`nano-banana\` and include the character count.
Target: 600-1200 characters. DO NOT compress or summarize.

---
### B. KLING MOTION PROMPT(S) (Exact Motion Recreation)
Write prompts that recreate EVERY movement from the reference video with frame-level precision.

KLING PROMPT MUST INCLUDE:
- HEADER: "Shot on iPhone front-facing camera, static locked-off camera, no camera movement, no zoom, no pan, no tilt."
- SEQUENTIAL ACTION CHAIN: Describe every movement in exact chronological order. Include: body part, direction, speed/quality, hands (even when idle), duration of each action, transitions, and micro-movements (sway, breath, fidget).
- EXPRESSION & ENERGY: Describe the FEELING (e.g., "radiating quiet confidence"), eye behavior (contact, glances), and mouth behavior (lips part, smile, mouths words).
- PACING: Note rhythm changes, pauses/holds, and audio sync.
- CLOSER: End with total duration: "[X] seconds."

FORMAT RULES:
- For ONE SHOT: One single prompt (1500-2500 characters).
- For MULTI-CLIP: One prompt per clip (400-800 characters each).

CRITICAL KLING RULES:
- NEVER say "she poses" or "she adjusts" — describe the EXACT physical movement.
- NEVER skip what hands are doing.
- NEVER use vague timing — every action gets a duration.
- ALWAYS describe transitions.
- ALWAYS include at least one micro-movement per 3 seconds.
- If talking, note "lips moving naturally as if speaking" in the sequence.

OUTPUT FORMAT: Wrap in a code block and include character count.

## 8. AUDIO ANALYSIS
- **Music:** [yes/no — if yes: genre, BPM estimate, energy level]
- **Voiceover/Talking:** [yes/no — if yes: tone, pacing, estimated word count]
- **Sound Effects:** [any notification sounds, ASMR, ambient noise]
- **Audio-Visual Sync:** [are cuts landing on beats? are actions timed to music drops?]

## 9. TEXT & OVERLAYS
- **On-Screen Text:** [list every text overlay with timestamp, font style, position, and what it says]
- **Captions/Subtitles:** [yes/no, style — TikTok auto-captions, custom styled, etc.]
- **Brand Elements:** [logos, watermarks, handles visible]

## 10. HOOK ANALYSIS (FIRST 3 SECONDS)
- **Visual Hook:** [what grabs attention in the first frame — action, text, expression?]
- **Pattern Interrupt:** [does it start mid-action, with a question, with movement?]
- **Would You Stop Scrolling:** [yes/no and why — be brutally honest]

## 11. RECREATION DIFFICULTY RATING
Rate each element 1-5 for AI recreation difficulty:
- Environment: [1-5] — [why]
- Character Motion: [1-5] — [why]
- Camera Work: [1-5] — [why]
- Overall: [1-5]
- **Recommended Format:** [ONE SHOT or MULTI-CLIP — and why for THIS specific video]

IMPORTANT RULES:
- Be extremely specific about physical actions.
- Note what BOTH hands are doing at all times.
- Describe FEELING of expressions.
- Note lip movement/talking.
- Distinguish between deliberate and micro-movements.
- When outputting prompts, ALWAYS format them inside code blocks so they're easy to copy.
- After every analysis, end with a "QUICK NOTES" section flagging anything that will be hard to recreate with AI and suggest workarounds.
- If the video has talking, break the script into sections and map each section to the corresponding clip/timestamp.
- CONTEXT MANAGEMENT RULE: Each video analysis is a standalone task. Do not reference or retain information from previous videos in this conversation. Treat every video upload as a fresh analysis with zero prior context. If the user uploads multiple videos, analyze ONLY the most recent one and ignore all previous uploads.`;

// --- Main Component ---
export default function App() {
  // Analyze state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [serverReady, setServerReady] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  // Library state
  const [mainTab, setMainTab] = useState<'analyze' | 'library'>('analyze');
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savGeneratingId, setSavGeneratingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const wakeServer = async () => {
      try {
        await fetch(`${PROXY_URL}/`, { signal: AbortSignal.timeout(60000) });
        setServerReady(true);
      } catch (_) {
        setServerReady(true);
      }
    };
    wakeServer();
  }, []);

  const loadLibrary = async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const items = await apiFetchLibrary();
      setLibrary(items);
    } catch (e: any) {
      setLibraryError(e.message || 'Failed to load library');
    } finally {
      setLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (mainTab === 'library') loadLibrary();
  }, [mainTab]);

  const ANALYSIS_STEPS = [
    'Reading video data',
    'Uploading to Gemini',
    'Deep AI Analysis',
    'Finalizing Report',
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please upload a valid video file.');
      return;
    }
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setError(null);
    setResult(null);
    setCurrentStep(0);
  };

  const onDragOver = (e: React.DragEvent) => e.preventDefault();

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const isValidUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const h = urlObj.hostname.toLowerCase();
      return h.includes('youtube.com') || h.includes('youtu.be') || h.includes('tiktok.com') ||
        h.includes('vm.tiktok.com') || h.includes('vt.tiktok.com') || h.includes('pinterest.com') || h.includes('pin.it');
    } catch { return false; }
  };

  const analyzeVideo = async () => {
    if (inputMode === 'upload' && !videoFile) return;
    if (inputMode === 'url' && !videoUrl) return;
    if (inputMode === 'url' && !isValidUrl(videoUrl)) {
      setError('Please enter a valid YouTube, TikTok, or Pinterest URL.');
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    setCurrentStep(0);
    try {
      setCurrentStep(1);
      const formData = new FormData();
      if (inputMode === 'upload') {
        formData.append('video', videoFile!, videoFile!.name);
      } else {
        formData.append('url', videoUrl);
      }
      setCurrentStep(2);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);
      const response = await fetch(`${PROXY_URL}/analyze`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }
      const data = await response.json();
      setCurrentStep(3);
      setResult(data.result || 'No analysis generated.');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string, id?: string) => {
    navigator.clipboard.writeText(text);
    if (id) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const reset = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setVideoUrl('');
    setResult(null);
    setError(null);
  };

  // --- Library Actions ---
  const saveToLibrary = async () => {
    if (!result) return;
    const formatType = detectFormatType(result);
    const item: LibraryItem = {
      id: Date.now().toString(),
      savedAt: new Date().toISOString(),
      sourceUrl: inputMode === 'url' ? videoUrl : undefined,
      formatType,
      hookText: extractHookText(result),
      fullAnalysis: result,
      nbPrompt: extractNBPrompt(result),
      klingPrompt: extractKlingPrompt(result),
    };
    try {
      await apiSaveItem(item);
      setLibrary((prev) => [item, ...prev]);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (e: any) {
      setError(e.message || 'Failed to save to library');
    }
  };

  const deleteFromLibrary = async (id: string) => {
    try {
      await apiDeleteItem(id);
      setLibrary((prev) => prev.filter((i) => i.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (e: any) {
      setLibraryError(e.message || 'Failed to delete item');
    }
  };

  const handleMakeForSav = async (id: string) => {
    const item = library.find((i) => i.id === id);
    if (!item) return;
    setSavGeneratingId(id);
    try {
      const savPrompts = await apiGenerateSavIdea(item.fullAnalysis);
      const updated: LibraryItem = { ...item, savPrompts };
      await apiSaveItem(updated);
      setLibrary((prev) => prev.map((i) => i.id === id ? updated : i));
      setExpandedId(id);
    } catch (e: any) {
      setLibraryError(e.message || 'Failed to generate Sav idea');
    } finally {
      setSavGeneratingId(null);
    }
  };

  const allFormatTypes = ['All', ...Array.from(new Set(library.map((i) => i.formatType)))];
  const filteredLibrary = filterType === 'All' ? library : library.filter((i) => i.formatType === filterType);

  // --- Render ---
  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#141414] flex items-center justify-center rounded-sm">
            <Zap className="text-[#E4E3E0] w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif italic text-xl leading-none">UGC Reverse-Engineer</h1>
            <p className="text-[10px] uppercase tracking-widest opacity-50 mt-1 font-mono">v2.0 / Format Library</p>
          </div>
        </div>

        {/* Main Tab Switcher */}
        <div className="flex items-center gap-1 bg-[#141414]/10 p-1 rounded">
          <button
            onClick={() => setMainTab('analyze')}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-widest transition-all flex items-center gap-2 ${
              mainTab === 'analyze' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'
            }`}
          >
            <Zap className="w-3 h-3" />
            Analyze
          </button>
          <button
            onClick={() => setMainTab('library')}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-widest transition-all flex items-center gap-2 ${
              mainTab === 'library' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'
            }`}
          >
            <Library className="w-3 h-3" />
            Library
            {library.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${mainTab === 'library' ? 'bg-[#E4E3E0] text-[#141414]' : 'bg-[#141414] text-[#E4E3E0]'}`}>
                {library.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {/* ===== ANALYZE TAB ===== */}
        {mainTab === 'analyze' && (
          <motion.main
            key="analyze"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
          >
            {/* Left Column */}
            <div className="lg:col-span-5 space-y-6">
              <section className="bg-white border border-[#141414] p-1 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                <div className="border border-[#141414] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-serif italic text-lg">Reference Video</h2>
                    <div className="flex gap-2 bg-[#141414]/5 p-1 rounded">
                      <button
                        onClick={() => { setInputMode('upload'); reset(); }}
                        className={`px-3 py-1 text-xs font-mono uppercase tracking-widest transition-all ${inputMode === 'upload' ? 'bg-[#141414] text-[#E4E3E0]' : 'text-[#141414] hover:bg-[#141414]/10'}`}
                      >
                        Upload
                      </button>
                      <button
                        onClick={() => { setInputMode('url'); reset(); }}
                        className={`px-3 py-1 text-xs font-mono uppercase tracking-widest transition-all ${inputMode === 'url' ? 'bg-[#141414] text-[#E4E3E0]' : 'text-[#141414] hover:bg-[#141414]/10'}`}
                      >
                        Paste URL
                      </button>
                    </div>
                  </div>

                  {inputMode === 'upload' && !videoPreview ? (
                    <div
                      onDragOver={onDragOver}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-[#141414]/20 aspect-video flex flex-col items-center justify-center cursor-pointer hover:bg-[#141414]/5 transition-colors group"
                    >
                      <Upload className="w-10 h-10 mb-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                      <p className="text-sm font-mono uppercase tracking-wider">Drop video or click to upload</p>
                      <p className="text-[10px] opacity-40 mt-2">MP4, MOV, WEBM · Max 20MB recommended</p>
                      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" className="hidden" />
                    </div>
                  ) : inputMode === 'upload' && videoPreview ? (
                    <div className="space-y-4">
                      <div className="relative aspect-video bg-black border border-[#141414]">
                        <video src={videoPreview} controls className="w-full h-full object-contain" />
                        <button onClick={reset} className="absolute top-2 right-2 p-2 bg-white border border-[#141414] hover:bg-[#141414] hover:text-white transition-colors">
                          <RefreshCcw className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-[#141414]/5 border border-[#141414]/10">
                        <div className="flex items-center gap-2">
                          <Video className="w-4 h-4 opacity-50" />
                          <span className="text-xs font-mono truncate max-w-[200px]">{videoFile?.name}</span>
                        </div>
                        <span className="text-[10px] font-mono opacity-50">{(videoFile!.size / (1024 * 1024)).toFixed(2)} MB</span>
                      </div>
                      {!serverReady && <p className="text-[10px] font-mono text-center opacity-50 animate-pulse">⏳ Waking up server...</p>}
                      <button
                        onClick={analyzeVideo}
                        disabled={isAnalyzing}
                        className="w-full bg-[#141414] text-[#E4E3E0] py-4 flex items-center justify-center gap-3 hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-widest text-sm font-bold"
                      >
                        {isAnalyzing ? <><Loader2 className="w-5 h-5 animate-spin" />Analyzing...</> : <>Start Analysis<ArrowRight className="w-5 h-5" /></>}
                      </button>
                    </div>
                  ) : inputMode === 'url' ? (
                    <div className="space-y-4">
                      <input
                        type="text"
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        placeholder="Paste YouTube Shorts, TikTok, or Pinterest link..."
                        className="w-full px-4 py-3 border border-[#141414] font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                      />
                      <p className="text-[10px] opacity-60 font-mono">Supported: YouTube Shorts, TikTok videos, Pinterest pins with video</p>
                      {!serverReady && <p className="text-[10px] font-mono text-center opacity-50 animate-pulse">⏳ Waking up server...</p>}
                      <button
                        onClick={analyzeVideo}
                        disabled={isAnalyzing || !videoUrl || !isValidUrl(videoUrl)}
                        className="w-full bg-[#141414] text-[#E4E3E0] py-4 flex items-center justify-center gap-3 hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-widest text-sm font-bold"
                      >
                        {isAnalyzing ? <><Loader2 className="w-5 h-5 animate-spin" />Analyzing...</> : <>Start Analysis<ArrowRight className="w-5 h-5" /></>}
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              {error && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-50 border border-red-200 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-800">Analysis Failed</p>
                    <p className="text-xs text-red-600 mt-1">{error}</p>
                  </div>
                </motion.div>
              )}

              {isAnalyzing && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest opacity-60">
                    <span>Processing Stream</span>
                    <span>{ANALYSIS_STEPS[currentStep]}...</span>
                  </div>
                  <div className="h-1 bg-[#141414]/10 w-full overflow-hidden">
                    <motion.div className="h-full bg-[#141414]" initial={{ width: '0%' }} animate={{ width: `${((currentStep + 1) / ANALYSIS_STEPS.length) * 100}%` }} transition={{ duration: 0.5 }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ANALYSIS_STEPS.map((step, i) => (
                      <div key={step} className={`flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest transition-opacity duration-300 ${i <= currentStep ? 'opacity-100' : 'opacity-20'}`}>
                        {i < currentStep ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : i === currentStep ? <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#141414]" /> : <div className="w-1.5 h-1.5 rounded-full bg-[#141414]/20" />}
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Results */}
            <div className="lg:col-span-7">
              <section className="bg-white border border-[#141414] flex flex-col shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                <div className="border-b border-[#141414] p-4 flex justify-between items-center bg-[#141414]/5">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    <h2 className="text-xs font-mono uppercase tracking-widest font-bold">Analysis Report</h2>
                  </div>
                  {result && (
                    <div className="flex items-center gap-3">
                      {/* Save to Library */}
                      <button
                        onClick={saveToLibrary}
                        className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-2 hover:underline text-emerald-700"
                      >
                        <BookmarkPlus className="w-3 h-3" />
                        {savedToast ? 'Saved!' : 'Save to Library'}
                      </button>
                      <span className="opacity-20">|</span>
                      <button onClick={() => copyToClipboard(result)} className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-2 hover:underline">
                        <Copy className="w-3 h-3" />
                        Copy Markdown
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-8">
                  {!result && !isAnalyzing && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                      <FileText className="w-16 h-16 mb-4" />
                      <p className="font-serif italic text-xl">Waiting for data...</p>
                      <p className="text-xs font-mono uppercase tracking-widest mt-2">Upload and analyze a video to see the breakdown</p>
                    </div>
                  )}
                  {isAnalyzing && !result && (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="relative">
                        <Loader2 className="w-12 h-12 animate-spin opacity-20" />
                        <Zap className="w-6 h-6 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                      </div>
                      <p className="font-serif italic text-xl mt-6">Analyzing Reference...</p>
                      <p className="text-xs font-mono uppercase tracking-widest mt-2 animate-pulse">This may take up to 60 seconds</p>
                    </div>
                  )}
                  {result && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="prose prose-sm max-w-none">
                      <div className="markdown-body">
                        <Markdown remarkPlugins={[remarkGfm]}>{result}</Markdown>
                      </div>
                    </motion.div>
                  )}
                </div>
              </section>
            </div>
          </motion.main>
        )}

        {/* ===== LIBRARY TAB ===== */}
        {mainTab === 'library' && (
          <motion.main
            key="library"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-7xl mx-auto p-6"
          >
            {/* Library Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-serif italic text-2xl">Format Library</h2>
                <p className="text-xs font-mono uppercase tracking-widest opacity-50 mt-1">{library.length} saved formats</p>
              </div>
              {/* Filter by type */}
              {library.length > 0 && (
                <div className="flex gap-2 flex-wrap justify-end">
                  {allFormatTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest border transition-all ${
                        filterType === type
                          ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                          : 'border-[#141414]/20 hover:border-[#141414]'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Loading State */}
            {libraryLoading && (
              <div className="flex flex-col items-center justify-center py-24 text-center opacity-40">
                <Loader2 className="w-10 h-10 animate-spin mb-4" />
                <p className="text-xs font-mono uppercase tracking-widest">Loading library from cloud...</p>
              </div>
            )}

            {/* Error State */}
            {libraryError && !libraryLoading && (
              <div className="bg-red-50 border border-red-200 p-4 flex gap-3 items-start mb-4">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-800">Library Error</p>
                  <p className="text-xs text-red-600 mt-1">{libraryError}</p>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!libraryLoading && !libraryError && library.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center opacity-30">
                <Library className="w-16 h-16 mb-4" />
                <p className="font-serif italic text-xl">Library is empty</p>
                <p className="text-xs font-mono uppercase tracking-widest mt-2">Analyze a video and click "Save to Library"</p>
              </div>
            )}

            {/* Library Cards */}
            <div className="space-y-4">
              {filteredLibrary.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
                >
                  {/* Card Header */}
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 border rounded-full ${FORMAT_COLORS[item.formatType] || FORMAT_COLORS['General Lifestyle']}`}>
                          <Tag className="w-2.5 h-2.5 inline mr-1" />
                          {item.formatType}
                        </span>
                        <span className="text-[10px] font-mono opacity-40">
                          {new Date(item.savedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        {item.sourceUrl && (
                          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono opacity-40 hover:opacity-100 underline truncate max-w-[200px]">
                            {item.sourceUrl}
                          </a>
                        )}
                      </div>
                      <p className="text-sm opacity-70 italic leading-snug">"{item.hookText}"</p>
                    </div>

                    {/* Card Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Make for Sav */}
                      {!item.savPrompts ? (
                        <button
                          onClick={() => handleMakeForSav(item.id)}
                          disabled={savGeneratingId === item.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-mono uppercase tracking-widest hover:bg-[#2a2a2a] disabled:opacity-50 transition-all"
                        >
                          {savGeneratingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          Make for Sav
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Sav Ready
                        </span>
                      )}

                      {/* Expand/Collapse */}
                      <button
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="p-2 border border-[#141414]/20 hover:border-[#141414] transition-colors"
                      >
                        {expandedId === item.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => deleteFromLibrary(item.id)}
                        className="p-2 border border-[#141414]/20 hover:border-red-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {expandedId === item.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-[#141414]/10"
                      >
                        <div className="p-5 space-y-6">
                          {/* Sav Prompts (if generated) */}
                          {item.savPrompts && (
                            <div className="bg-[#141414] text-[#E4E3E0] p-5 space-y-5">
                              <div className="flex items-center gap-2 mb-4">
                                <Sparkles className="w-4 h-4" />
                                <h3 className="text-xs font-mono uppercase tracking-widest font-bold">Sav Prompts</h3>
                              </div>

                              {/* Formula + Brief */}
                              {item.savPrompts.whyItWorks && (
                                <div className="bg-white/10 p-3 space-y-2">
                                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Why It Works</p>
                                  <p className="text-xs leading-relaxed opacity-90">{item.savPrompts.whyItWorks}</p>
                                </div>
                              )}
                              {item.savPrompts.creativeBrief && (
                                <div className="bg-white/10 p-3 space-y-2">
                                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Creative Brief</p>
                                  <p className="text-xs leading-relaxed opacity-90">{item.savPrompts.creativeBrief}</p>
                                </div>
                              )}

                              {/* NB Prompt */}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">NB Prompt</p>
                                  <button onClick={() => copyToClipboard(item.savPrompts!.nbPrompt, item.id + '-nb')} className="text-[10px] font-mono opacity-50 hover:opacity-100 flex items-center gap-1">
                                    <Copy className="w-2.5 h-2.5" />{copiedId === item.id + '-nb' ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                                <pre className="text-xs leading-relaxed whitespace-pre-wrap opacity-90 bg-white/5 p-3">{item.savPrompts.nbPrompt || '— No NB prompt extracted —'}</pre>
                              </div>

                              {/* SD Prompt */}
                              {item.savPrompts.sdPrompt && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">SD Prompt (Seedream body pass)</p>
                                    <button onClick={() => copyToClipboard(item.savPrompts!.sdPrompt!, item.id + '-sd')} className="text-[10px] font-mono opacity-50 hover:opacity-100 flex items-center gap-1">
                                      <Copy className="w-2.5 h-2.5" />{copiedId === item.id + '-sd' ? 'Copied!' : 'Copy'}
                                    </button>
                                  </div>
                                  <pre className="text-xs leading-relaxed whitespace-pre-wrap opacity-90 bg-white/5 p-3">{item.savPrompts.sdPrompt}</pre>
                                </div>
                              )}

                              {/* Kling Prompt */}
                              {item.savPrompts.klingPrompt && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Kling Prompt</p>
                                    <button onClick={() => copyToClipboard(item.savPrompts!.klingPrompt, item.id + '-kling')} className="text-[10px] font-mono opacity-50 hover:opacity-100 flex items-center gap-1">
                                      <Copy className="w-2.5 h-2.5" />{copiedId === item.id + '-kling' ? 'Copied!' : 'Copy'}
                                    </button>
                                  </div>
                                  <pre className="text-xs leading-relaxed whitespace-pre-wrap opacity-90 bg-white/5 p-3">{item.savPrompts.klingPrompt}</pre>
                                </div>
                              )}

                              {/* Text Overlays */}
                              <div>
                                <p className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">Text Overlay Options</p>
                                <div className="space-y-2">
                                  {item.savPrompts.textOverlays.map((overlay, i) => (
                                    <div key={i} className="flex items-center justify-between bg-white/5 p-2.5">
                                      <span className="text-xs italic opacity-90">"{overlay}"</span>
                                      <button onClick={() => copyToClipboard(overlay, item.id + '-overlay-' + i)} className="text-[10px] font-mono opacity-40 hover:opacity-100 ml-3 shrink-0 flex items-center gap-1">
                                        <Copy className="w-2.5 h-2.5" />{copiedId === item.id + '-overlay-' + i ? 'Copied!' : 'Copy'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Caption */}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">IG Caption</p>
                                  <button onClick={() => copyToClipboard(item.savPrompts!.caption, item.id + '-caption')} className="text-[10px] font-mono opacity-50 hover:opacity-100 flex items-center gap-1">
                                    <Copy className="w-2.5 h-2.5" />{copiedId === item.id + '-caption' ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                                <div className="bg-white/5 p-2.5 text-xs italic opacity-90">"{item.savPrompts.caption}"</div>
                              </div>
                            </div>
                          )}

                          {/* Full Analysis */}
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Full Analysis</p>
                              <button onClick={() => copyToClipboard(item.fullAnalysis, item.id + '-full')} className="text-[10px] font-mono opacity-50 hover:opacity-100 flex items-center gap-1">
                                <Copy className="w-2.5 h-2.5" />{copiedId === item.id + '-full' ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                            <div className="markdown-body text-sm max-h-[500px] overflow-y-auto border border-[#141414]/10 p-4">
                              <Markdown remarkPlugins={[remarkGfm]}>{item.fullAnalysis}</Markdown>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto p-6 mt-12 border-t border-[#141414]/10 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">© 2026 UGC Reverse-Engineering Analyst Tool</p>
        <div className="flex gap-6">
          <a href="#" className="text-[10px] font-mono uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">Documentation</a>
          <a href="#" className="text-[10px] font-mono uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">API Status</a>
        </div>
      </footer>
    </div>
  );
}
