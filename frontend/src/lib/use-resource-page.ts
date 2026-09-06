"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-client";
import { resourceQueryKey, writeResourceQuery, type ResourceQuery } from "./resource-query";

interface PageState { page: number; totalPages: number; error: string }

export function useResourcePage<T extends PageState>(
  initialState: T, initialQuery: ResourceQuery, query: ResourceQuery,
  load: (query: ResourceQuery) => Promise<T>,
  path: string, pageKey = "page", enabled = true,
) {
  const [state, setState] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const requestedKey = useRef(resourceQueryKey(initialQuery));
  const requestId = useRef(0);
  const retryQuery = useRef(initialQuery);
  const mounted = useRef(true);
  const active = useRef(enabled);
  const initialCorrection = useRef(!initialState.error && initialState.page > initialState.totalPages);

  const run = useCallback(async (requested: ResourceQuery) => {
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
        break;
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) setState((value) => ({ ...value, error: getApiErrorMessage(error, "Could not load results.") }));
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [load, path, pageKey]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) return;
    writeResourceQuery(path, query, { replace: true, pageKey, includeScope: path === "/search" });
    if (requestedKey.current !== resourceQueryKey(query) || initialCorrection.current) {
      initialCorrection.current = false;
      void run(query);
    }
  }, [enabled, path, query, run, pageKey]);

  return { state, loading, run, retry: () => run(retryQuery.current) };
}
