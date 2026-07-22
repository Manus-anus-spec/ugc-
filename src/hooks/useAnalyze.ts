import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormatDna } from '@shared/contract';
import { analyzeFile, analyzeUrl } from '../api';
import { ApiRequestError } from '../api/client';

export type AnalyzeStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * One /analyze call is a single long request (the worker resolves, uploads, watches,
 * validates, and saves before responding) — so progress is an honest elapsed clock,
 * not fake stages.
 */
export function useAnalyze() {
  const [status, setStatus] = useState<AnalyzeStatus>('idle');
  const [result, setResult] = useState<FormatDna | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const run = useCallback(async (input: { url?: string; file?: File }) => {
    setStatus('running');
    setResult(null);
    setError(null);
    setElapsed(0);
    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    try {
      const res = input.file ? await analyzeFile(input.file) : await analyzeUrl(input.url ?? '');
      if (!res.format) throw new Error('analysis returned no format');
      setResult(res.format);
      setStatus('done');
    } catch (e) {
      if (e instanceof ApiRequestError) setError({ code: e.api.code, message: e.api.error });
      else setError({ code: 'client', message: e instanceof Error ? e.message : String(e) });
      setStatus('error');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
    setElapsed(0);
  }, []);

  return { status, result, error, elapsed, run, reset };
}
