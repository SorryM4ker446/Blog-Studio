"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FileRecord } from "@/lib/api";
import { getApiErrorMessage, getFiles, searchResources } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import { CloudIcon, FolderIcon } from "@/components/Icons";
import FileCard from "@/components/files/FileCard";
import { FilePreviewDialog } from "@/components/files/FileDialogs";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AsyncState";

export default function DrivePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const fileRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const retryRequestRef = useRef<
    { type: "page"; page: number } | { type: "search"; query: string }
  >({ type: "page", page: 1 });

  const loadFiles = useCallback(async (pageToLoad: number) => {
    const requestId = ++fileRequestIdRef.current;
    retryRequestRef.current = { type: "page", page: pageToLoad };
    setLoading(true);
    setError("");
    try {
      const result = await getFiles(pageToLoad, 10);
      if (result.error) throw new Error(result.error);
      if (requestId !== fileRequestIdRef.current) return;
      setFiles(result.data);
      setPage(result.page);
      setTotalPages(Math.max(1, Math.ceil(result.total / result.limit)));
    } catch (requestError) {
      if (requestId !== fileRequestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "Could not load files."));
    } finally {
      if (requestId === fileRequestIdRef.current) setLoading(false);
    }
  }, []);

  const searchFiles = useCallback(async (query: string) => {
    const requestId = ++searchRequestIdRef.current;
    retryRequestRef.current = { type: "search", query };
    setLoading(true);
    setError("");
    try {
      const res = await searchResources(query, "files");
      if (requestId !== searchRequestIdRef.current) return;
      setFiles(res.files || []);
      setPage(1);
      setTotalPages(1);
    } catch (requestError) {
      if (requestId !== searchRequestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "Could not search files."));
    } finally {
      if (requestId === searchRequestIdRef.current) setLoading(false);
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
    if (normalizedQuery === searchQuery.trim()) {
      if (normalizedQuery) {
        searchFiles(normalizedQuery);
      } else {
        loadFiles(1);
      }
      return;
    }
    router.push(normalizedQuery ? `/drive?q=${encodeURIComponent(normalizedQuery)}` : "/drive");
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPreviewFile(null);
      if (searchQuery.trim()) {
        searchFiles(searchQuery.trim());
      } else {
        loadFiles(1);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      fileRequestIdRef.current += 1;
      searchRequestIdRef.current += 1;
    };
  }, [loadFiles, searchFiles, searchQuery]);

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
          onPageChange={(p) => loadFiles(p)} 
        />
      )}

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

