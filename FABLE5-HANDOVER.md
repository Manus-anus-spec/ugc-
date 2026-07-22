# Fable 5 Handover — UGC Reverse-Engineer Rebuild

## How to run it (do this exactly)
1. Open a **new Claude Code session** with its working directory set to this folder: `/Users/mac/Desktop/ugc-`
2. Switch the model to **Fable 5**: type `/model` → choose **Fable 5** (`claude-fable-5`).
3. Paste the prompt in the box below (everything between the `─── PROMPT ───` lines).
4. Nothing else needs attaching — see "What to attach" at the bottom.

─────────────────────────── PROMPT ───────────────────────────

You are Fable 5, the engineer + designer rebuilding this app end to end. The app repo — and your working directory — is `/Users/mac/Desktop/ugc-`. All paths below are absolute so reads work regardless of where the session started; when you CREATE new files, create them under `/Users/mac/Desktop/ugc-`. You have full filesystem access — read anything you need directly; do not ask me to paste files.

**START HERE — read these four files in full before doing anything else. They are the source of truth and contain the entire vision, every locked decision, the complete data schema, the target architecture, and the phased build plan:**
1. `/Users/mac/Desktop/ugc-/REBUILD-BRIEF.md` — what we want and why (vision, competitive wedge, product requirements, locked decisions, the ideation principle in §4g).
2. `/Users/mac/Desktop/ugc-/FABLE5-PLAN.md` — the audit + full re-architecture plan (schema §3; generation §5 has the ideation ADDENDUM; build sequence §8; open questions §9).
3. `/Users/mac/Desktop/ugc-/docs/current-app-map.md` — honest map + shortfalls of the current code (with file:line).
4. `/Users/mac/Desktop/ugc-/docs/higgsfield-research.md` — the competitor (Higgsfield) analysis + the gaps we exploit.

**The app you're rebuilding:**
- Frontend (this repo): `src/App.tsx` (1,646-line monolith), `src/main.tsx`, `src/index.css`, `vite.config.ts`, `package.json`. Vite/React, deploys to GitHub Pages.
- Backend workers (OUTSIDE this folder — read them at these absolute paths):
  - Analyze proxy (Gemini): `/Users/mac/Desktop/worker-v4.2.0.js`
  - Content library (KV): `/Users/mac/Desktop/Desktop/Aruna Talent - files/Sav Brain/workers/sav-content-library/worker.js`
  - Viral scanner (KV + generation + a separate Telegram/cron pipeline that must keep working): `/Users/mac/Desktop/Desktop/Aruna Talent - files/Sav Brain/workers/sav-viral-scanner/sav-viral-scanner.js`

**Already done — do NOT redo (Phase 0 hotfixes are applied):** in `src/App.tsx` the `url`→`videoUrl` field fix and Instagram URL unblock; in `vite.config.ts` the `GEMINI_API_KEY` `define` was removed. The brief + plan already reflect all locked decisions including ideation-not-clone. Start from Phase 1.

**Locked decisions you must build within (full detail in the docs):**
- Analysis engine = OUR OWN: Gemini **Pro** tier + a deep prompt returning **structured JSON against a schema** (no prose→regex). Not Higgsfield.
- Virality scoring = deferred to v2.
- Model-agnostic via swappable **model profiles** (Sav, Naomi, Niko template) — zero hard-coded identity anywhere.
- Output portable prompts for: **NanoBanana / ChatGPT-2** (image), **C-dream/Seedream** (body/edit), **C-dance 2.0 / Kling** (motion).
- **Generation = IDEATION, not clone**: produce a NEW treatment that keeps the ~80% that made the OG work (`whyItWorks` mechanism + `swapMap.mustKeep`) and reinvents the rest — **~3 distinct ideations per blueprint**. (Brief §4g, Plan §5 addendum.)
- One authenticated Cloudflare Worker (`ugc-api`) + **D1** (not KV), one shared TypeScript/zod contract imported by worker and frontend.

**You also own the visual redesign.** Khian wants you to redesign the layout, colours, UI, and UX — not just refactor. At the start of the frontend phase, briefly propose a design direction (mood, palette, layout) for a fast, premium tool built for a solo operator, then build it. You may load the `artifact-design` skill for design calibration if useful. The current look is a dark violet theme — you're free to keep, refine, or replace it.

**Hard constraints:**
- The sandbox blocks network. **You write code; Khian runs all deploys, secrets, and the live model-id check.** Mark every step that needs Khian at the keyboard with 🔑. Never ask for or embed real secrets/API keys — use env-var names; Khian supplies values at deploy.
- The `sav-viral-scanner` worker's Telegram/cron pipeline must keep running — only stop the app pointing at its app-facing routes; don't break the cron path.
- **Work phase by phase per Plan §8. At the end of each phase, stop and check in with Khian** — do not run all phases blindly. Plan before you build within each phase.

**Your first move:** read the four files, then reply with (a) a 3-5 line confirmation that you've absorbed the vision + decisions, (b) anything in the plan you'd change or flag, and (c) your proposed Phase 1 kickoff (the `shared/` contract + `ugc-api` skeleton + D1 schema). Then wait for Khian's go before writing code.

─────────────────────────── END PROMPT ───────────────────────────

## What to attach when prompting Fable 5
- **Files:** NONE. Because you run it as a Claude Code session inside `/Users/mac/Desktop/ugc-`, it reads every file itself (the four spec docs, all source, and the workers via the absolute paths in the prompt). You do not paste or upload anything.
- **Website URL:** NOT required. It rebuilds from source, not the live page. (Optional: you can mention the live URL only if you want it to visually reference the current look — but it will redesign anyway, so it's not needed.)
- **Secrets / API keys:** DO NOT paste any. Fable 5 writes code using env-var names; you set the real Gemini key, RapidAPI key, and D1 binding as Cloudflare secrets yourself at deploy time (the 🔑 steps).
- **The only thing you provide during the build:** answers to the plan's open questions (§9) as each phase reaches them, and running the 🔑 deploy/secret steps on your keyboard.
