"use client";

import { useState, useEffect } from "react";
import type { FileRecord } from "@/lib/api";
import { getFiles, getDownloadUrl, searchResources } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function DrivePage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    loadFiles(1);
  }, []);

  async function loadFiles(pageToLoad: number) {
    setLoading(true);
    const result = await getFiles(pageToLoad, 10);
    setFiles(result.data);
    setPage(result.page);
    setTotalPages(Math.ceil(result.total / result.limit));
    setLoading(false);
  }

  async function handleSearch(query: string) {
    if (!query.trim()) {
      loadFiles(1);
      return;
    }
    const res = await searchResources(query, "files");
    setFiles(res.files || []);
    setTotalPages(1); // Disable pagination during search
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 className="page-title">☁️ Cloud Drive</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
            Browse and download available resources. Admin operations are moved to Editor section.
          </p>
        </div>
        <SearchInput placeholder="Search files..." onSearch={handleSearch} style={{ width: "250px" }} />
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
          <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📂</p>
          No files uploaded yet.
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          {files.map((file) => (
            <div
              key={file.id}
              className="ai-card"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: "1rem 1.5rem",
              }}
            >
              <div
                className="card-icon"
                style={{
                  backgroundColor: "rgba(168, 199, 250, 0.12)",
                  color: "var(--accent-blue)",
                  marginRight: "1.2rem",
                  flexShrink: 0,
                }}
              >
                📎
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4
                  style={{
                    margin: 0,
                    fontWeight: 500,
                    fontSize: "1rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {file.orig_name}
                </h4>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-muted)",
                    marginTop: "0.2rem",
                  }}
                >
                  {formatSize(file.size)} • {file.mime_type} •{" "}
                  {new Date(file.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <a
                  href={getDownloadUrl(file.id)}
                  style={{
                    background: "rgba(109, 214, 140, 0.12)",
                    color: "var(--accent-green)",
                    padding: "4px 12px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    textDecoration: "none",
                    transition: "opacity 0.2s",
                  }}
                >
                  ⬇ Download
                </a>
              </div>
            </div>
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
    </div>
  );
}

