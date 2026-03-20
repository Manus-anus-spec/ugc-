/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Config ---
const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://ugc-worker.khian-moclou.workers.dev';

// --- Types ---
interface AnalysisResult {
  markdown: string;
}

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

// --- Components ---

export default function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [serverReady, setServerReady] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wake up the Render backend on page load to avoid cold start delays
  useEffect(() => {
    const wakeServer = async () => {
      try {
        await fetch(`${PROXY_URL}/`, { signal: AbortSignal.timeout(60000) });
        setServerReady(true);
      } catch (_) {
        setServerReady(true); // proceed anyway
      }
    };
    wakeServer();
  }, []);

  const ANALYSIS_STEPS = [
    "Reading video data",
    "Uploading to Gemini",
    "Deep AI Analysis",
    "Finalizing Report"
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError("Please upload a valid video file.");
      return;
    }
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setError(null);
    setResult(null);
    setCurrentStep(0);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const isValidUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return (
        hostname.includes('youtube.com') || 
        hostname.includes('youtu.be') ||
        hostname.includes('tiktok.com') ||
        hostname.includes('vm.tiktok.com') ||
        hostname.includes('vt.tiktok.com') ||
        hostname.includes('pinterest.com') ||
        hostname.includes('pin.it')
      );
    } catch {
      return false;
    }
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
      // Step 0: Prepare data
      setCurrentStep(0);

      // Step 1: Upload to proxy server
      setCurrentStep(1);
      const formData = new FormData();
      
      if (inputMode === 'upload') {
        formData.append('video', videoFile!, videoFile!.name);
      } else {
        formData.append('url', videoUrl);
      }

      // Step 2: Deep AI Analysis (proxy handles upload + Gemini call)
      setCurrentStep(2);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout
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

      // Step 3: Finalizing
      setCurrentStep(3);
      setResult(data.result || 'No analysis generated.');

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add a toast here
  };

  const reset = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setVideoUrl('');
    setResult(null);
    setError(null);
  };

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
            <p className="text-[10px] uppercase tracking-widest opacity-50 mt-1 font-mono">v1.0 / Analyst Mode</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-[11px] uppercase tracking-widest font-mono opacity-60">
          <span>AI-Powered Breakdown</span>
          <span className="w-1 h-1 bg-[#141414] rounded-full"></span>
          <span>Prompt Generation</span>
          <span className="w-1 h-1 bg-[#141414] rounded-full"></span>
          <span>Action Mapping</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Upload & Preview */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-[#141414] p-1 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="border border-[#141414] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif italic text-lg">Reference Video</h2>
                <div className="flex gap-2 bg-[#141414]/5 p-1 rounded">
                  <button
                    onClick={() => {
                      setInputMode('upload');
                      reset();
                    }}
                    className={`px-3 py-1 text-xs font-mono uppercase tracking-widest transition-all ${
                      inputMode === 'upload'
                        ? 'bg-[#141414] text-[#E4E3E0]'
                        : 'text-[#141414] hover:bg-[#141414]/10'
                    }`}
                  >
                    Upload
                  </button>
                  <button
                    onClick={() => {
                      setInputMode('url');
                      reset();
                    }}
                    className={`px-3 py-1 text-xs font-mono uppercase tracking-widest transition-all ${
                      inputMode === 'url'
                        ? 'bg-[#141414] text-[#E4E3E0]'
                        : 'text-[#141414] hover:bg-[#141414]/10'
                    }`}
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
                  <p className="text-[10px] opacity-40 mt-2">MP4, MOV, WEBM (Max 20MB recommended)</p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="video/*" 
                    className="hidden" 
                  />
                </div>
              ) : inputMode === 'upload' && videoPreview ? (
                <div className="space-y-4">
                  <div className="relative aspect-video bg-black border border-[#141414]">
                    <video 
                      src={videoPreview} 
                      controls 
                      className="w-full h-full object-contain"
                    />
                    <button 
                      onClick={reset}
                      className="absolute top-2 right-2 p-2 bg-white border border-[#141414] hover:bg-[#141414] hover:text-white transition-colors"
                    >
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

                  {!serverReady && (
                    <p className="text-[10px] font-mono text-center opacity-50 animate-pulse">⏳ Waking up server... (first load may take ~30s)</p>
                  )}
                  <button 
                    onClick={analyzeVideo}
                    disabled={isAnalyzing}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-4 flex items-center justify-center gap-3 hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-widest text-sm font-bold"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        Start Analysis
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              ) : inputMode === 'url' && !videoUrl ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="Paste YouTube Shorts, TikTok, or Pinterest link..."
                    className="w-full px-4 py-3 border border-[#141414] font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                  <p className="text-[10px] opacity-60 font-mono">Supported: YouTube Shorts, TikTok videos, Pinterest pins with video</p>
                  {!serverReady && (
                    <p className="text-[10px] font-mono text-center opacity-50 animate-pulse">⏳ Waking up server... (first load may take ~30s)</p>
                  )}
                  <button 
                    onClick={analyzeVideo}
                    disabled={isAnalyzing || !videoUrl || !isValidUrl(videoUrl)}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-4 flex items-center justify-center gap-3 hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-widest text-sm font-bold"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        Start Analysis
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 p-4 flex gap-3 items-start"
            >
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
                <motion.div 
                  className="h-full bg-[#141414]"
                  initial={{ width: "0%" }}
                  animate={{ width: `${((currentStep + 1) / ANALYSIS_STEPS.length) * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ANALYSIS_STEPS.map((step, i) => (
                  <div key={step} className={`flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest transition-opacity duration-300 ${i <= currentStep ? 'opacity-100' : 'opacity-20'}`}>
                    {i < currentStep ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    ) : i === currentStep ? (
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#141414]" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-[#141414]/20" />
                    )}
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
                <button 
                  onClick={() => copyToClipboard(result)}
                  className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-2 hover:underline"
                >
                  <Copy className="w-3 h-3" />
                  Copy Markdown
                </button>
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
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:italic prose-headings:border-b prose-headings:border-[#141414]/10 prose-headings:pb-2 prose-p:font-sans prose-p:text-[#141414]/80 prose-li:text-[#141414]/80"
                >
                  <div className="markdown-body">
                    <Markdown remarkPlugins={[remarkGfm]}>{result}</Markdown>
                  </div>
                </motion.div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto p-6 mt-12 border-t border-[#141414]/10 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">
          © 2026 UGC Reverse-Engineering Analyst Tool
        </p>
        <div className="flex gap-6">
          <a href="#" className="text-[10px] font-mono uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">Documentation</a>
          <a href="#" className="text-[10px] font-mono uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">API Status</a>
          <a href="#" className="text-[10px] font-mono uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">Privacy Policy</a>
        </div>
      </footer>
    </div>
  );
}
