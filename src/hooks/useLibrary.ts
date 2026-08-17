import { useCallback, useEffect, useState } from 'react';
import type { FormatSummary } from '@shared/contract';
import { deleteFormat, listFormats, type LibraryQuery } from '../api';

/** Server-side queried library list — no fetch-everything, no client filtering. */
export function useLibrary() {
  const [query, setQuery] = useState<LibraryQuery>({});
  const [items, setItems] = useState<FormatSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (q: LibraryQuery) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listFormats(q);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(query); }, [query, refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteFormat(id);
    await refresh(query);
  }, [query, refresh]);

  return { query, setQuery, items, total, loading, error, remove, refresh: () => refresh(query) };
}
