import { useCallback, useState } from 'react';
import { clearToken, getToken, setToken } from '../api/client';
import { listFormats } from '../api';

/** localStorage token gate. Validates a candidate token with a real API call. */
export function useAuthToken() {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (candidate: string) => {
    setChecking(true);
    setError(null);
    setToken(candidate.trim());
    try {
      await listFormats({ limit: 1 });
      setTokenState(candidate.trim());
    } catch {
      clearToken();
      setError('That key was rejected by the API.');
    } finally {
      setChecking(false);
    }
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setTokenState(null);
  }, []);

  return { token, submit, signOut, checking, error };
}
