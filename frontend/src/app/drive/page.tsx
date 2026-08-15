"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FileRecord } from "@/lib/api";
import { getFiles, searchResources } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import { CloudIcon, FolderIcon } from "@/components/Icons";
import FileCard from "@/components/files/FileCard";
import { FilePreviewDialog } from "@/components/files/FileDialogs";

export default function DrivePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const fileRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);

  const loadFiles = useCallback(async (pageToLoad: number) => {
    const requestId = ++fileRequestIdRef.current;
    setLoading(true);
    const result = await getFiles(pageToLoad, 10);
    if (requestId !== fileRequestIdRef.current) {
      return;
    }
    setFiles(result.data);
    setPage(result.page);
    setTotalPages(Math.ceil(result.total / result.limit));
    setLoading(false);
  }, []);

  const searchFiles = useCallback(async (query: string) => {
    const requestId = ++searchRequestIdRef.current;
    setLoading(true);
    const res = await searchResources(query, "files");
    if (requestId !== searchRequestIdRef.current) {
      return;
    }
    setFiles(res.files || []);
    setPage(1);
    setTotalPages(1);
    setLoading(false);
  }, []);

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
          key={searchQuery}
          placeholder="Search files..."
          onSearch={handleSearch}
          style={{ width: "250px" }}
          value={searchQuery}
        />
      </div>

      {/* 文件列表 */}
      {loading && files.length === 0 ? (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton-pulse" style={{ height: "64px", borderRadius: "12px" }} />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div
          style={{
            padding: "3rem",
            textAlign: "center",
            color: "var(--text-muted)",
            background: "var(--bg-surface)",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem", opacity: 0.5 }}>
            <FolderIcon size={48} />
          </div>
          No files uploaded yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {files.map((file) => (
            <FileCard key={file.id} file={file} onPreview={setPreviewFile} showDescription={false} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && files.length > 0 && (
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

