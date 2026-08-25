"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { FileRecord } from "@/lib/api";
import { getApiErrorMessage, getFiles, searchResources } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import { CloudIcon, FolderIcon } from "@/components/Icons";
import FileCard from "@/components/files/FileCard";
import { FilePreviewDialog } from "@/components/files/FileDialogs";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AsyncState";

export interface DrivePageInitialState {
  query: string;
  files: FileRecord[];
  page: number;
  totalPages: number;
  error: string;
}

export default function DrivePageClient({ initialState }: { initialState: DrivePageInitialState }) {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const [files, setFiles] = useState<FileRecord[]>(initialState.files);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialState.error);
  const [page, setPage] = useState(initialState.page);
  const [totalPages, setTotalPages] = useState(initialState.totalPages);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const requestIdRef = useRef(0);
  const visibleQueryRef = useRef(initialState.query.trim());
  const visiblePageRef = useRef(initialState.page);
  const defaultSnapshotRef = useRef<DrivePageInitialState | null>(initialState.query.trim() ? null : initialState);
  const retryRequestRef = useRef<
    { type: "page"; page: number } | { type: "search"; query: string }
  >(searchQuery.trim()
    ? { type: "search", query: searchQuery.trim() }
    : { type: "page", page: initialState.page });

  const loadFiles = useCallback(async (pageToLoad: number) => {
    visibleQueryRef.current = "";
    visiblePageRef.current = pageToLoad;
    const requestId = ++requestIdRef.current;
    retryRequestRef.current = { type: "page", page: pageToLoad };
    setLoading(true);
    setError("");
    try {
      const result = await getFiles(pageToLoad, 10);
      if (result.error) throw new Error(result.error);
      if (requestId !== requestIdRef.current) return;
      setFiles(result.data);
      setPage(result.page);
      const nextTotalPages = Math.max(1, Math.ceil(result.total / result.limit));
      setTotalPages(nextTotalPages);
      defaultSnapshotRef.current = {
        query: "",
        files: result.data,
        page: result.page,
        totalPages: nextTotalPages,
        error: "",
      };
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "Could not load files."));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const searchFiles = useCallback(async (query: string) => {
    visibleQueryRef.current = query;
    visiblePageRef.current = 1;
    const requestId = ++requestIdRef.current;
    retryRequestRef.current = { type: "search", query };
    setLoading(true);
    setError("");
    try {
      const res = await searchResources(query, "files");
      if (requestId !== requestIdRef.current) return;
      setFiles(res.files || []);
      setPage(1);
      setTotalPages(1);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "Could not search files."));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  function retryLastRequest() {
    const request = retryRequestRef.current;
    if (request.type === "search") {
      void searchFiles(request.query);
    } else {
      void loadFiles(request.page);
    }
  }

  function handleSearch(query: string) {
    const normalizedQuery = query.trim();
    const currentQuery = new URLSearchParams(window.location.search).get("q")?.trim() || "";
    if (normalizedQuery === currentQuery) {
      if (normalizedQuery) {
        searchFiles(normalizedQuery);
      } else {
        loadFiles(1);
      }
      return;
    }
    window.history.pushState(
      null,
      "",
      normalizedQuery ? `/drive?q=${encodeURIComponent(normalizedQuery)}` : "/drive",
    );
    if (normalizedQuery) {
      void searchFiles(normalizedQuery);
    } else {
      const snapshot = defaultSnapshotRef.current;
      if (snapshot) {
        setFiles(snapshot.files);
        setPage(snapshot.page);
        setTotalPages(snapshot.totalPages);
      }
      void loadFiles(snapshot?.page || 1);
    }
  }

  function handlePageChange(nextPage: number) {
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.set("page", nextPage.toString());
    window.history.pushState(null, "", `/drive?${params.toString()}`);
    void loadFiles(nextPage);
  }

  useEffect(() => {
    const query = searchQuery.trim();
    const parsedPage = Number.parseInt(searchParams.get("page") || "1", 10);
    const targetPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    if (query) {
      if (visibleQueryRef.current !== query) void searchFiles(query);
      return;
    }
    if (visibleQueryRef.current || visiblePageRef.current !== targetPage) {
      const snapshot = defaultSnapshotRef.current;
      if (snapshot) {
        setFiles(snapshot.files);
        setPage(snapshot.page);
        setTotalPages(snapshot.totalPages);
      }
      void loadFiles(targetPage);
    }
  }, [loadFiles, searchFiles, searchParams, searchQuery]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <CloudIcon size={28} /> Cloud Drive
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
            Browse and download available resources. Admin operations are moved to Editor section.
          </p>
        </div>
        <SearchInput
          placeholder="Search files..."
          onSearch={handleSearch}
          style={{ width: "250px" }}
          value={searchQuery}
        />
      </div>

      <section aria-label="Files" aria-busy={loading}>
      {error ? (
        <ErrorState message={error} onRetry={retryLastRequest} retrying={loading} />
      ) : loading && files.length === 0 ? (
        <LoadingState label={searchQuery ? "Searching files…" : "Loading files…"} />
      ) : files.length === 0 ? (
        <EmptyState
          title={searchQuery ? "No matching files" : "No files yet"}
          message={searchQuery
            ? `No files match “${searchQuery}”. Try another file name.`
            : "No public files have been uploaded yet."}
          icon={<FolderIcon size={48} />}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {files.map((file) => (
            <FileCard key={file.id} file={file} onPreview={setPreviewFile} showDescription={false} />
          ))}
        </div>
      )}
      </section>

      {/* Pagination */}
      {!error && !loading && files.length > 0 && (
        <Pagination 
          currentPage={page} 
          totalPages={totalPages} 
          onPageChange={handlePageChange}
        />
      )}

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

