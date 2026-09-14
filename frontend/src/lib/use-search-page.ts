"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "./api-client";
import { readSearchQuery, searchQueryKey, writeSearchQuery, type SearchQuery } from "./search-query";
import type { SearchResults } from "./search-results";
import { isClientNavigation } from "./navigation-entry";

interface SearchState extends SearchResults { error: string }

export function useSearchPage<T extends SearchState>(initial: T, query: SearchQuery, load: (query: SearchQuery) => Promise<T>) {
  const [restoring, setRestoring] = useState(() => searchQueryKey(initial) !== searchQueryKey(query));
  const [state, setState] = useState(() => searchQueryKey(initial) === searchQueryKey(query) ? initial : { ...initial, ...query, posts: [], files: [], error: "",
    ...("searched" in initial ? { searched: Boolean(query.query) } : {}),
    postTotalPages: Math.max(query.postPage, initial.postTotalPages), fileTotalPages: Math.max(query.filePage, initial.fileTotalPages) });
  const [loading, setLoading] = useState(false);
  const requestedKey = useRef(searchQueryKey(initial));
  const retryQuery = useRef<SearchQuery>(initial);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const correction = useRef(!initial.error && (initial.postPage > initial.postTotalPages || initial.filePage > initial.fileTotalPages));
  const revalidateEntry = useRef(isClientNavigation());

  const run = useCallback(async (requested: SearchQuery) => {
    const id = ++requestId.current;
    const isCurrent = () => window.location.pathname === "/search"
      && searchQueryKey(readSearchQuery(new URLSearchParams(window.location.search))) === searchQueryKey(requested);
    let target = requested;
    requestedKey.current = searchQueryKey(target);
    retryQuery.current = target;
    setLoading(true);
    setState(value => ({ ...value, error: "" }));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await load(target);
        if (!mounted.current || id !== requestId.current || !isCurrent()) return;
        if (result.error) throw new Error(result.error);
        const corrected = { ...target, postPage: Math.min(result.postPage, result.postTotalPages), filePage: Math.min(result.filePage, result.fileTotalPages) };
        if (attempt === 0 && searchQueryKey(corrected) !== searchQueryKey(target)) {
          target = corrected;
          continue;
        }
        requestedKey.current = searchQueryKey(target);
        retryQuery.current = target;
        writeSearchQuery(target, true);
        setState(result);
        break;
      }
    } catch (error) {
      if (mounted.current && id === requestId.current && isCurrent()) {
        setState(value => ({ ...value, error: getApiErrorMessage(error, "Could not load results.") }));
      }
    } finally {
      if (mounted.current && id === requestId.current) { setLoading(false); setRestoring(false); }
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const location = window.location.href;
    const frame = window.requestAnimationFrame(() => {
      if (window.location.href === location) writeSearchQuery(query, true);
    });
    if (requestedKey.current !== searchQueryKey(query) || correction.current || revalidateEntry.current) {
      correction.current = false;
      revalidateEntry.current = false;
      void run(query);
    }
    return () => window.cancelAnimationFrame(frame);
  }, [query, run]);

  return { state, loading: loading || restoring, restoring, run, retry: () => run(retryQuery.current) };
}
