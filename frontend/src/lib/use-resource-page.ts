"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-client";
import { resourceQueryKey, writeResourceQuery, type ResourceQuery } from "./resource-query";
import { listCacheGeneration, readListReturnCache, writeListReturnCache } from "./list-return-cache";
import { isClientNavigation, navigationRevision } from "./navigation-entry";

interface PageState { page: number; totalPages: number; error: string }

export function useResourcePage<T extends PageState>(
  initialState: T, initialQuery: ResourceQuery, query: ResourceQuery,
  load: (query: ResourceQuery) => Promise<T>,
  path: string, pageKey = "page", enabled = true, cacheScope?: string,
) {
  const cachePrefix = cacheScope ? JSON.stringify([cacheScope, path, pageKey]) : "";
  const [entry] = useState(() => {
    const mismatch = enabled && resourceQueryKey(initialQuery) !== resourceQueryKey(query);
    const revalidate = isClientNavigation();
    const snapshot = cachePrefix && (mismatch || revalidate) ? readListReturnCache<T>(cachePrefix + resourceQueryKey(enabled ? query : initialQuery)) : undefined;
    return { state: snapshot ?? (mismatch ? { ...initialState, ...query,
      ...("data" in initialState && Array.isArray(initialState.data) ? { data: [] } : {}),
      ...("posts" in initialState ? { posts: [] } : {}), ...("files" in initialState ? { files: [] } : {}),
      ...("currentCategoryName" in initialState && initialQuery.categoryId !== query.categoryId ? { currentCategoryName: null } : {}),
      totalPages: Math.max(query.page, initialState.totalPages), error: "" } : initialState), restoring: mismatch && !snapshot, revalidate };
  });
  const [state, setState] = useState(entry.state);
  const [resultQuery, setResultQuery] = useState(enabled ? query : initialQuery);
  const [restoring, setRestoring] = useState(entry.restoring);
  const [loading, setLoading] = useState(false);
  const requestedKey = useRef(resourceQueryKey(initialQuery));
  const requestId = useRef(0);
  const retryQuery = useRef(initialQuery);
  const mounted = useRef(true);
  const active = useRef(enabled);
  const owner = useRef(cachePrefix);
  owner.current = cachePrefix;
  const initialCorrection = useRef(!initialState.error && initialState.page > initialState.totalPages);
  const revalidateEntry = useRef(entry.revalidate);
  const initialCache = useRef({ cachePrefix, enabled, initialState, initialQuery, generation: listCacheGeneration() });
  const observedQuery = useRef(resourceQueryKey(query));
  if (observedQuery.current !== resourceQueryKey(query)) {
    observedQuery.current = resourceQueryKey(query);
    if (requestedKey.current !== observedQuery.current) requestId.current++;
  }

  const run = useCallback(async (requested: ResourceQuery) => {
    const generation = listCacheGeneration();
    const navigation = navigationRevision();
    let target = requested;
    const id = ++requestId.current;
    requestedKey.current = resourceQueryKey(target);
    retryQuery.current = target;
    setLoading(true);
    setState((value) => ({ ...value, error: "" }));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await load(target);
        if (!mounted.current || id !== requestId.current || generation !== listCacheGeneration() || owner.current !== cachePrefix || navigation !== navigationRevision()) return;
        if (result.error) throw new Error(result.error);
        if (attempt === 0 && result.page > result.totalPages) {
          target = { ...target, page: result.totalPages };
          requestedKey.current = resourceQueryKey(target);
          retryQuery.current = target;
          if (active.current) writeResourceQuery(path, target, { replace: true, pageKey, includeScope: path === "/search" });
          continue;
        }
        setState(result);
        setResultQuery(target);
        if (cachePrefix) writeListReturnCache(cachePrefix + resourceQueryKey(target), result, generation);
        break;
      }
    } catch (error) {
      if (mounted.current && id === requestId.current && generation === listCacheGeneration() && owner.current === cachePrefix && navigation === navigationRevision()) setState((value) => ({ ...value, error: getApiErrorMessage(error, "Could not load results.") }));
    } finally {
      if (mounted.current && id === requestId.current) { setLoading(false); setRestoring(false); }
    }
  }, [load, path, pageKey, cachePrefix]);

  useEffect(() => {
    mounted.current = true;
    const cached = initialCache.current;
    if (cached.cachePrefix && cached.enabled && !cached.initialState.error && !entry.revalidate) {
      writeListReturnCache(cached.cachePrefix + resourceQueryKey(cached.initialQuery), cached.initialState, cached.generation);
    }
    return () => { mounted.current = false; };
  }, [entry.revalidate]);

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
    if (requestedKey.current !== resourceQueryKey(query) || initialCorrection.current || revalidateEntry.current) {
      initialCorrection.current = false;
      revalidateEntry.current = false;
      void run(query);
    }
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, path, query, run, pageKey]);

  return { state, resultQuery, loading: loading || restoring, restoring, run, retry: () => run(retryQuery.current) };
}
