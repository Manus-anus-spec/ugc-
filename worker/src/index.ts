/**
 * ugc-api — the one worker (FABLE5-PLAN §2).
 * Every route requires X-API-Key except /health. Errors are typed ApiError JSON
 * with real HTTP status codes — never a 200 wrapping an error (fixes N2).
 */
import type { Env } from './env';
import { GeminiQuotaError, configureGeminiEndpoint } from './gemini';
import { authenticate } from './auth';
import { capMessage, countPaidCall } from './spend';
import { err, handleOptions, json } from './http';
import { analyze } from './routes/analyze';
import { generate, generateVariant, getGeneration, listGenerations, patchGeneration } from './routes/generate';
import {
  createFormat, deleteFormat, getFormat, getFormatSeedance, getVersion, listFormats, listVersions,
  reindexFts, updateFormat,
} from './routes/formats';
import { exportBriefs, exportFormat, exportJson } from './routes/export';
import { deleteProfile, getProfile, listProfiles, putProfile } from './routes/profiles';
import { getJob } from './routes/jobs';
import { backfillTaxonomy } from './routes/admin';
import { synthesisCoverage } from './routes/coverage';
import { libraryInsights } from './routes/insights';
import { rescoreVirality } from './routes/rescore';
import { qaBeat } from './routes/qa';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return handleOptions(req, env);
    // Route Gemini through AI Gateway when configured. Idempotent, cheap, and must run
    // before any handler that may call Gemini.
    configureGeminiEndpoint(env);

    const url = new URL(req.url);
    const seg = url.pathname.split('/').filter(Boolean);
    const m = req.method;

    try {
      if (m === 'GET' && seg[0] === 'health') {
        return json({ ok: true, service: 'ugc-api' }, 200, req, env);
      }

      const operator = await authenticate(req, env);
      if (!operator) return err('unauthorized', 'missing or invalid X-API-Key', 401, req, env);

      // ── analyze ──
      if (m === 'POST' && seg[0] === 'analyze' && seg.length === 1) {
        // §P2 spend guard. Counted here in the router rather than inside the route so the
        // two paid endpoints share one implementation and neither can forget it.
        const cap = await countPaidCall(env, operator, 'analyze');
        if (!cap.allowed) return err('daily_cap', capMessage('analyze', cap), 429, req, env);
        return await analyze(req, env, ctx);
      }

      // ── generate ──
      if (m === 'POST' && seg[0] === 'generate' && seg.length === 1) {
        const cap = await countPaidCall(env, operator, 'generate');
        if (!cap.allowed) return err('daily_cap', capMessage('generate', cap), 429, req, env);
        return await generate(req, env, ctx);
      }
      // Internal SELF dispatch: one ideation variant per invocation (own CPU budget).
      if (m === 'POST' && seg[0] === 'generate' && seg[1] === 'variant' && seg.length === 2) {
        return await generateVariant(req, env);
      }
      if (m === 'GET' && seg[0] === 'generations' && seg[1] && seg.length === 2) {
        return await getGeneration(req, env, seg[1]);
      }
      // Feedback loop (Phase 3): the operator's verdict on a finished run.
      if (m === 'PATCH' && seg[0] === 'generations' && seg[1] && seg.length === 2) {
        return await patchGeneration(req, env, seg[1]);
      }

      // ── formats ──
      if (seg[0] === 'formats') {
        if (seg.length === 1) {
          if (m === 'GET') return await listFormats(req, env);
          if (m === 'POST') return await createFormat(req, env);
        }
        const id = seg[1];
        if (id && seg.length === 2) {
          if (m === 'GET') return await getFormat(req, env, id);
          if (m === 'PUT') return await updateFormat(req, env, id);
          if (m === 'DELETE') return await deleteFormat(req, env, id);
        }
        if (id && seg[2] === 'generations' && m === 'GET' && seg.length === 3) {
          return await listGenerations(req, env, id);
        }
        // Seedance JSON for the SOURCE video — the copy-with-tweaks path. Pure derivation
        // from stored DNA: no Gemini call, no cost.
        if (id && seg[2] === 'seedance' && m === 'GET' && seg.length === 3) {
          return await getFormatSeedance(req, env, id);
        }
        if (id && seg[2] === 'export' && m === 'GET' && seg.length === 3) {
          return await exportFormat(req, env, id);
        }
        if (id && seg[2] === 'versions') {
          if (m === 'GET' && seg.length === 3) return await listVersions(req, env, id);
          if (m === 'GET' && seg.length === 4) {
            const v = Number(seg[3]);
            if (!Number.isInteger(v)) return err('invalid_version', 'version must be an integer', 400, req, env);
            return await getVersion(req, env, id, v);
          }
        }
      }

      // ── profiles ──
      if (seg[0] === 'profiles') {
        if (seg.length === 1 && m === 'GET') return await listProfiles(req, env);
        const id = seg[1];
        if (id && seg.length === 2) {
          if (m === 'GET') return await getProfile(req, env, id);
          if (m === 'PUT') return await putProfile(req, env, id);
          if (m === 'DELETE') return await deleteProfile(req, env, id);
        }
      }

      // ── qa loopback (Part H — optional/hero-only render inspection) ──
      if (m === 'POST' && seg[0] === 'qa' && seg[1] && seg[2] !== undefined && seg.length === 3) {
        return await qaBeat(req, env, ctx, seg[1], Number(seg[2]));
      }

      // ── jobs ──
      if (m === 'GET' && seg[0] === 'jobs' && seg[1] && seg.length === 2) {
        return await getJob(req, env, seg[1]);
      }

      // ── exports ──
      if (m === 'GET' && seg[0] === 'export') {
        if (seg[1] === 'json' && seg.length === 2) return await exportJson(req, env);
        if (seg[1] === 'briefs' && seg.length === 2) return await exportBriefs(req, env);
      }

      // ── admin ──
      if (m === 'POST' && seg[0] === 'admin' && seg[1] === 'reindex-fts' && seg.length === 2) {
        return await reindexFts(req, env);
      }
      // Phase 4 coverage telemetry — pure SQL aggregation, no Gemini cost, safe to poll.
      if (m === 'GET' && seg[0] === 'admin' && seg[1] === 'synthesis-coverage' && seg.length === 2) {
        return await synthesisCoverage(req, env);
      }
      // Research: what the analysed library already knows about hook/retention/payoff.
      // Pure aggregation in SQLite — no Gemini call, no cost.
      if (m === 'GET' && seg[0] === 'admin' && seg[1] === 'library-insights' && seg.length === 2) {
        return await libraryInsights(req, env);
      }
      // Rescore stored formats onto the current rubric. Batched, idempotent, and NEVER
      // automatic — it overwrites scores and spends Gemini money, both operator decisions.
      if (m === 'POST' && seg[0] === 'admin' && seg[1] === 'rescore-virality' && seg.length === 2) {
        return await rescoreVirality(req, env, ctx);
      }
      if (m === 'POST' && seg[0] === 'admin' && seg[1] === 'backfill-taxonomy' && seg.length === 2) {
        return await backfillTaxonomy(req, env, ctx);
      }

      return err('not_found', `no route: ${m} ${url.pathname}`, 404, req, env);
    } catch (e) {
      // Quota problems are operational, not bugs — surface them as such so the UI
      // shows "top up billing / wait a minute" instead of a scary INTERNAL dump.
      if (e instanceof GeminiQuotaError) {
        const code = e.kind === 'spend_cap' ? 'gemini_billing_cap' : 'gemini_rate_limited';
        return err(code, e.message, 503, req, env);
      }
      const message = e instanceof Error ? e.message : String(e);
      return err('internal', message, 500, req, env);
    }
  },
};
