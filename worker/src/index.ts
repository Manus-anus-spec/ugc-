/**
 * ugc-api — the one worker (FABLE5-PLAN §2).
 * Every route requires X-API-Key except /health. Errors are typed ApiError JSON
 * with real HTTP status codes — never a 200 wrapping an error (fixes N2).
 */
import type { Env } from './env';
import { authenticate } from './auth';
import { err, handleOptions, json } from './http';
import { analyze } from './routes/analyze';
import {
  createFormat, deleteFormat, getFormat, getVersion, listFormats, listVersions, updateFormat,
} from './routes/formats';
import { deleteProfile, getProfile, listProfiles, putProfile } from './routes/profiles';
import { getJob } from './routes/jobs';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return handleOptions(req, env);

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
        return await analyze(req, env, ctx);
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

      // ── jobs ──
      if (m === 'GET' && seg[0] === 'jobs' && seg[1] && seg.length === 2) {
        return await getJob(req, env, seg[1]);
      }

      return err('not_found', `no route: ${m} ${url.pathname}`, 404, req, env);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err('internal', message, 500, req, env);
    }
  },
};
