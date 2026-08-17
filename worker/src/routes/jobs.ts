import type { Job } from '../../../shared/contract';
import type { Env } from '../env';
import { err, json } from '../http';

interface JobRow {
  id: string; kind: string; status: string;
  result_format_id: string | null; error: string | null;
  created_at: string; updated_at: string;
}

export async function getJob(req: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, kind, status, result_format_id, error, created_at, updated_at FROM jobs WHERE id = ?'
  ).bind(id).first<JobRow>();
  if (!row) return err('not_found', `job ${id} not found`, 404, req, env);
  const job: Job = {
    id: row.id,
    kind: row.kind as Job['kind'],
    status: row.status as Job['status'],
    resultFormatId: row.result_format_id ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return json(job, 200, req, env);
}
