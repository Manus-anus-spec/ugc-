import { useCallback, useState } from 'react';
import { ApiRequestError, clearToken, getToken, setToken } from '../api/client';
import { listFormats } from '../api';

/**
 * localStorage token gate — paste once per device, remembered forever.
 * The key is validated with a real API call at entry, but ONLY a genuine 401
 * rejects it; transient network errors keep the key stored (remember-me must
 * never bounce a valid key because wifi blipped). Cleared only by sign-out.
 */
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
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        clearToken();
        setError('That key was rejected by the API.');
      } else {
        // network hiccup / API briefly down — accept optimistically, stay remembered
        setTokenState(candidate.trim());
      }
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
