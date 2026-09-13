"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-client";
import { resourceQueryKey, writeResourceQuery, type ResourceQuery } from "./resource-query";
import { listCacheGeneration, readListReturnCache, writeListReturnCache } from "./list-return-cache";

interface PageState { page: number; totalPages: number; error: string }

export function useResourcePage<T extends PageState>(
  initialState: T, initialQuery: ResourceQuery, query: ResourceQuery,
  load: (query: ResourceQuery) => Promise<T>,
  path: string, pageKey = "page", enabled = true, cacheScope?: string,
) {
  const cachePrefix = cacheScope ? JSON.stringify([cacheScope, path, pageKey]) : "";
  const [entry] = useState(() => {
    const mismatch = Boolean(cachePrefix) && enabled && resourceQueryKey(initialQuery) !== resourceQueryKey(query);
    const snapshot = mismatch ? readListReturnCache<T>(cachePrefix + resourceQueryKey(query)) : undefined;
    return { state: snapshot ?? initialState, restoring: mismatch && !snapshot };
  });
  const [state, setState] = useState(entry.state);
  const [restoring, setRestoring] = useState(entry.restoring);
  const [loading, setLoading] = useState(false);
  const requestedKey = useRef(resourceQueryKey(initialQuery));
  const requestId = useRef(0);
  const retryQuery = useRef(initialQuery);
  const mounted = useRef(true);
  const active = useRef(enabled);
  const initialCorrection = useRef(!initialState.error && initialState.page > initialState.totalPages);
  const initialCache = useRef({ cachePrefix, enabled, initialState, initialQuery, generation: listCacheGeneration() });

  const run = useCallback(async (requested: ResourceQuery) => {
    const generation = listCacheGeneration();
    let target = requested;
    const id = ++requestId.current;
    requestedKey.current = resourceQueryKey(target);
    retryQuery.current = target;
    setLoading(true);
    setState((value) => ({ ...value, error: "" }));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await load(target);
        if (!mounted.current || id !== requestId.current) return;
        if (result.error) throw new Error(result.error);
        if (attempt === 0 && result.page > result.totalPages) {
          target = { ...target, page: result.totalPages };
          requestedKey.current = resourceQueryKey(target);
          retryQuery.current = target;
          if (active.current) writeResourceQuery(path, target, { replace: true, pageKey, includeScope: path === "/search" });
          continue;
        }
        setState(result);
        if (cachePrefix) writeListReturnCache(cachePrefix + resourceQueryKey(target), result, generation);
        break;
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) setState((value) => ({ ...value, error: getApiErrorMessage(error, "Could not load results.") }));
    } finally {
      if (mounted.current && id === requestId.current) { setLoading(false); setRestoring(false); }
    }
  }, [load, path, pageKey, cachePrefix]);

  useEffect(() => {
    mounted.current = true;
    const cached = initialCache.current;
    if (cached.cachePrefix && cached.enabled && !cached.initialState.error) {
      writeListReturnCache(cached.cachePrefix + resourceQueryKey(cached.initialQuery), cached.initialState, cached.generation);
    }
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) return;
    const location = window.location.href;
    // Let the router install its history integration before normalizing the initial URL.
    const frame = window.requestAnimationFrame(() => {
      if (window.location.href === location) {
        writeResourceQuery(path, query, { replace: true, pageKey, includeScope: path === "/search" });
      }
    });
    if (requestedKey.current !== resourceQueryKey(query) || initialCorrection.current) {
      initialCorrection.current = false;
      void run(query);
    }
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, path, query, run, pageKey]);

  return { state, loading: loading || restoring, restoring, run, retry: () => run(retryQuery.current) };
}
