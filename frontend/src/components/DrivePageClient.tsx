"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FileRecord } from "@/lib/api";
import { getFiles, searchResources } from "@/lib/api";
import { readResourceQuery, writeResourceQuery, type ResourceQuery } from "@/lib/resource-query";
import { useResourcePage } from "@/lib/use-resource-page";
import SearchInput from "@/components/SearchInput";
import PaginatedResults from "@/components/PaginatedResults";
import ListPending from "@/components/ListPending";
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
  const [animatePages, setAnimatePages] = useState(false);
  const searchParams = useSearchParams();
  const query = useMemo(() => readResourceQuery(searchParams, "files"), [searchParams]);
  const searchQuery = query.query;
  const load = useCallback(async (target: ResourceQuery): Promise<DrivePageInitialState> => {
    const result = target.query ? await searchResources(target) : await getFiles(target.page, 10);
    const total = "files_total" in result ? result.files_total : result.total;
    return { query: target.query, files: "files" in result ? result.files : result.data,
      page: result.page, totalPages: Math.max(1, Math.ceil(total / result.limit)), error: "" };
  }, []);
  const { state, loading, restoring, run, retry: retryLastRequest } = useResourcePage(
    initialState, { query: initialState.query, categoryId: "", scope: "files", page: initialState.page }, query, load, "/drive", "page", true, "public",
  );
  const { files, error, page, totalPages } = state;
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  function handleSearch(value: string) {
    setAnimatePages(true);
    const target = { ...readResourceQuery(new URLSearchParams(window.location.search), "files"), query: value.trim(), page: 1 };
    writeResourceQuery("/drive", target);
    void run(target);
  }
  function handlePageChange(page: number) {
    setAnimatePages(true);
    const target = { ...readResourceQuery(new URLSearchParams(window.location.search), "files"), page };
    writeResourceQuery("/drive", target);
    void run(target);
  }

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
      ) : restoring ? (
        <PaginatedResults page={query.page} totalPages={Math.max(query.page, totalPages)} pending animateChanges={false}
          resultKey={JSON.stringify([query.query, query.page])} onPageChange={handlePageChange}>
          <ListPending label="Loading files…" />
        </PaginatedResults>
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
        <PaginatedResults page={page} totalPages={totalPages} pending={loading} animateChanges={animatePages}
          resultKey={JSON.stringify([state.query, page])} onPageChange={handlePageChange}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {files.map((file) => (
            <FileCard key={file.id} file={file} onPreview={setPreviewFile} showDescription={false} />
          ))}
        </div>
        </PaginatedResults>
      )}
      </section>

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

