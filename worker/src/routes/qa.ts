/**
 * POST /qa/:generationId/:beatIndex — the render loopback (Part H), the only honest
 * "auto-fix": the app normally emits prompts blind; this route lets the operator feed
 * a GENERATED still/clip back in and runs the vision model as an AI-tell detector
 * (plastic skin, dead eyes, wrong physics, too-smooth camera, missing blinks, silent
 * track, face-match vs an attached reference sheet, fidelity vs the source beat).
 * Returns { readsAsAI, faceMatchScore, fidelityToSource, tells[], fixes[] } where
 * fixes[] are the targeted per-field edits for regenerating the offending beat.
 * OPTIONAL / HERO-ONLY: every call is a paid Pro vision call — use on hero posts.
 *
 * multipart fields: media (REQUIRED image/video file — the generated output),
 * reference (optional image — profile face sheet for faceMatchScore),
 * ideationIndex (optional int, default 0).
 */
import { z } from 'zod';
import { QaVerdictSchema } from '../../../shared/schemas';
import type { FormatDna, GenerationRun } from '../../../shared/contract';
import type { Env } from '../env';
import { err, json } from '../http';
import {
  callGeminiJson, deleteGeminiFile, extractJson, uploadToGemini, type GeminiPart,
} from '../gemini';
import { QA_TELL_DETECTOR_SYSTEM_INSTRUCTION } from '../prompt';

const QA_JSON_SCHEMA = z.toJSONSchema(QaVerdictSchema) as Record<string, unknown>;
const INLINE_LIMIT_BYTES = 6_000_000;   // ~6MB base64-able inline; larger → File API

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function qaBeat(
  req: Request, env: Env, ctx: ExecutionContext, generationId: string, beatIndex: number,
): Promise<Response> {
  if (!Number.isInteger(beatIndex) || beatIndex < 0) {
    return err('invalid_beat', 'beatIndex must be a non-negative integer', 400, req, env);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('invalid_body', 'expected multipart/form-data with a "media" file', 400, req, env);
  }
  const media = form.get('media');
  if (!(media instanceof File)) {
    return err('no_media', 'attach the generated still/clip as the "media" file field', 400, req, env);
  }
  const reference = form.get('reference');
  const ideationIndex = Number(form.get('ideationIndex') ?? 0);

  // ── Load the run + beat + source beat context ──
  const row = await env.DB.prepare('SELECT output FROM generations WHERE id = ?')
    .bind(generationId).first<{ output: string }>();
  if (!row) return err('not_found', `generation ${generationId} not found`, 404, req, env);
  const run = JSON.parse(row.output) as GenerationRun;
  const ideation = run.ideations[ideationIndex];
  if (!ideation) return err('not_found', `ideation ${ideationIndex} not found on this run`, 404, req, env);
  const beat = ideation.beats[beatIndex];
  if (!beat) return err('not_found', `beat ${beatIndex} not found (ideation has ${ideation.beats.length})`, 404, req, env);

  const formatRow = await env.DB.prepare('SELECT dna FROM formats WHERE id = ?')
    .bind(run.formatId).first<{ dna: string }>();
  const dna = formatRow ? JSON.parse(formatRow.dna) as FormatDna : null;
  const sourceBeat = dna && beat.sourceBeatIndex !== undefined && beat.sourceBeatIndex >= 0
    ? dna.beats[beat.sourceBeatIndex] ?? null
    : null;

  // ── Media parts: small images inline; video (or big files) via the File API ──
  const parts: GeminiPart[] = [];
  const mediaType = media.type || 'application/octet-stream';
  const isVideo = mediaType.startsWith('video/');
  let uploadedName: string | null = null;
  const mediaBuf = await media.arrayBuffer();
  if (!isVideo && mediaBuf.byteLength <= INLINE_LIMIT_BYTES) {
    parts.push({ inlineData: { mimeType: mediaType, data: toBase64(mediaBuf) } });
  } else {
    const uploaded = await uploadToGemini(env.GEMINI_API_KEY, mediaBuf, mediaType);
    uploadedName = uploaded.name;
    parts.push({ fileData: { mimeType: mediaType, fileUri: uploaded.uri }, ...(isVideo ? { videoMetadata: { fps: 8 } } : {}) });
  }
  let hasReference = false;
  if (reference instanceof File) {
    const refBuf = await reference.arrayBuffer();
    if (refBuf.byteLength <= INLINE_LIMIT_BYTES) {
      parts.push({ inlineData: { mimeType: reference.type || 'image/png', data: toBase64(refBuf) } });
      hasReference = true;
    }
  }

  const spec = {
    beatSpec: {
      action: beat.action, camera: beat.camera, expression: beat.expression,
      shotSize: beat.shotSize, cameraAngle: beat.cameraAngle, durationSec: beat.durationSec,
      motionBeat: beat.motionBeat, secondaryMotion: beat.secondaryMotion, microExpression: beat.microExpression,
      motionPrompt: beat.motionPrompt,
    },
    sourceBeat,
    aesthetic: dna?.aesthetic ?? null,
    cameraDynamics: dna?.camera.dynamics ?? null,
  };
  parts.push({
    text: `PRODUCTION SPEC for the attached ${isVideo ? 'clip' : 'still'} (beat ${beatIndex}${hasReference ? '; the SECOND image is the face reference sheet' : '; no reference sheet attached — faceMatchScore must be null'}${sourceBeat ? '' : '; no source beat — fidelityToSource must be null'}):\n${JSON.stringify(spec, null, 1)}\n\nRun the tell detection now.`,
  });

  try {
    const r = await callGeminiJson({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      systemInstruction: QA_TELL_DETECTOR_SYSTEM_INSTRUCTION,
      parts,
      jsonSchema: QA_JSON_SCHEMA,
      temperature: 0,
      maxOutputTokens: 4096,
      ...(isVideo ? { mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' as const } : {}),
    });
    const verdict = QaVerdictSchema.safeParse(JSON.parse(extractJson(r.text)));
    if (!verdict.success) {
      return err('qa_invalid', 'tell-detector output failed schema validation', 502, req, env, verdict.error.issues.slice(0, 10));
    }
    return json({ generationId, ideationIndex, beatIndex, ...verdict.data }, 200, req, env);
  } finally {
    if (uploadedName) ctx.waitUntil(deleteGeminiFile(env.GEMINI_API_KEY, uploadedName));
  }
}
