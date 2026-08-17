import { useCallback, useRef, useState } from 'react';

/** Copy-with-tick-feedback used on every prompt/payload block. */
export function useClipboard(resetMs = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedKey(null), resetMs);
  }, [resetMs]);

  return { copiedKey, copy };
}
