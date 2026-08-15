"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { FileMutationResult, FileRecord } from "@/lib/api";
import { getDownloadUrl, getFileViewUrl } from "@/lib/api";
import { DownloadIcon, EditIcon, FileTextIcon, UploadIcon } from "@/components/Icons";
import { getFileLabel } from "./FileCard";
import styles from "./FileDialogs.module.css";

const acceptedFileTypes = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.csv,.json,.zip,.doc,.xls,.ppt,.docx,.xlsx,.pptx";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DialogShellProps {
  open: boolean;
  title: string;
  eyebrow: string;
  subtitle?: string;
  wide?: boolean;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

function DialogShell({ open, title, eyebrow, subtitle, wide, busy, onClose, children, footer }: DialogShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")
        || panelRef.current?.querySelector<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)',
        );
      initialFocus?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.dialog} ${wide ? styles.wideDialog : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  );
}

interface FilePreviewDialogProps {
  file: FileRecord | null;
  onClose: () => void;
  onEdit?: (file: FileRecord) => void;
}

export function FilePreviewDialog({ file, onClose, onEdit }: FilePreviewDialogProps) {
  if (!file) return null;
  const label = getFileLabel(file);
  const isImage = file.mime_type.startsWith("image/");

  return (
    <DialogShell
      open
      wide
      eyebrow="File preview"
      title={label}
      subtitle={file.description || "Review file details before downloading."}
      onClose={onClose}
      footer={
        <>
          {onEdit && (
            <button type="button" className={styles.button} onClick={() => onEdit(file)}>
              <EditIcon size={14} /> Edit details
            </button>
          )}
          <a className={`${styles.button} ${styles.primary}`} href={getDownloadUrl(file.id)} download>
            <DownloadIcon size={14} /> Download
          </a>
        </>
      }
    >
      <div className={styles.previewStage}>
        {isImage ? (
          // The file endpoint performs server-side content validation before allowing inline images.
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.previewImage} src={getFileViewUrl(file.id)} alt={label} />
        ) : (
          <div className={styles.fileFallback}>
            <span className={styles.fallbackIcon}><FileTextIcon size={30} /></span>
            <span>Inline preview is available for validated images. Download this file to inspect its contents.</span>
          </div>
        )}
      </div>
      <dl className={styles.details}>
        <div className={styles.detail}>
          <dt>Original file</dt>
          <dd>{file.orig_name}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Type</dt>
          <dd>{file.mime_type}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Size</dt>
          <dd>{formatSize(file.size)}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Uploaded</dt>
          <dd>{new Date(file.created_at).toLocaleString()}</dd>
        </div>
        <div className={`${styles.detail} ${styles.descriptionBlock}`}>
          <dt>Description</dt>
          <dd>{file.description || "No description provided."}</dd>
        </div>
      </dl>
    </DialogShell>
  );
}

interface FileUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File, displayName: string, description: string) => Promise<FileMutationResult>;
}

export function FileUploadDialog({ open, onClose, onUpload }: FileUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function chooseFile(file: File | null) {
    if (!file) return;
    setSelectedFile(file);
    setDisplayName(file.name);
    setError("");
  }

  async function submit() {
    if (!selectedFile || !displayName.trim() || saving) return;
    setSaving(true);
    setError("");
    const result = await onUpload(selectedFile, displayName.trim(), description.trim());
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Could not upload file");
      return;
    }
    onClose();
  }

  return (
    <DialogShell
      open={open}
      eyebrow="New file"
      title="Upload a file"
      subtitle="Add a clear public name and optional context before publishing it to Drive."
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={submit}
            disabled={!selectedFile || !displayName.trim() || saving}
          >
            {saving ? "Uploading…" : "Upload file"}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <input
          ref={inputRef}
          type="file"
          accept={acceptedFileTypes}
          hidden
          onChange={(event) => chooseFile(event.target.files?.[0] || null)}
        />
        {selectedFile ? (
          <div className={styles.selectedFile}>
            <span className={styles.selectedIcon}><FileTextIcon size={18} /></span>
            <span className={styles.selectedMeta}>
              <span className={styles.selectedName}>{selectedFile.name}</span>
              <span className={styles.selectedSize}>{formatSize(selectedFile.size)} · {selectedFile.type || "Unknown type"}</span>
            </span>
            <button type="button" className={styles.replaceButton} onClick={() => inputRef.current?.click()} disabled={saving}>
              Replace
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-autofocus
            className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event: DragEvent<HTMLButtonElement>) => {
              event.preventDefault();
              setDragging(false);
              chooseFile(event.dataTransfer.files?.[0] || null);
            }}
          >
            <span>
              <span className={styles.dropIcon}><UploadIcon size={19} /></span>
              <span className={styles.dropTitle}>Choose a file or drag it here</span>
              <span className={styles.dropText}>
                JPG, PNG, GIF, WebP, PDF, TXT, MD, CSV, JSON, ZIP, DOC, XLS, PPT, DOCX, XLSX, or PPTX.
              </span>
            </span>
          </button>
        )}

        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Display name</span>
            <span className={styles.counter}>{displayName.length}/255</span>
          </span>
          <input
            className={styles.input}
            data-autofocus
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value.slice(0, 255))}
            placeholder="File name shown in Drive"
            maxLength={255}
            disabled={saving}
          />
          <span className={styles.helper}>The original filename remains unchanged for downloads and type validation.</span>
        </label>

        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Description</span>
            <span className={styles.counter}>{description.length}/500</span>
          </span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 500))}
            placeholder="What is this file for?"
            maxLength={500}
            disabled={saving}
          />
        </label>
        <p className={styles.error} role="alert" aria-live="polite">{error}</p>
      </div>
    </DialogShell>
  );
}

interface FileEditDialogProps {
  file: FileRecord;
  onClose: () => void;
  onSave: (file: FileRecord, displayName: string, description: string) => Promise<FileMutationResult>;
}

export function FileEditDialog({ file, onClose, onSave }: FileEditDialogProps) {
  const [displayName, setDisplayName] = useState(() => getFileLabel(file));
  const [description, setDescription] = useState(() => file.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!displayName.trim() || saving) return;
    setSaving(true);
    setError("");
    const result = await onSave(file, displayName.trim(), description.trim());
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Could not save file details");
      return;
    }
    onClose();
  }

  return (
    <DialogShell
      open
      eyebrow="File settings"
      title="Edit file details"
      subtitle={`Original file: ${file.orig_name}`}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={submit}
            disabled={!displayName.trim() || saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Display name</span>
            <span className={styles.counter}>{displayName.length}/255</span>
          </span>
          <input
            className={styles.input}
            data-autofocus
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value.slice(0, 255))}
            maxLength={255}
            disabled={saving}
          />
          <span className={styles.helper}>Changing this label does not rename the stored file or alter its download type.</span>
        </label>
        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Description</span>
            <span className={styles.counter}>{description.length}/500</span>
          </span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 500))}
            maxLength={500}
            placeholder="Add context for readers"
            disabled={saving}
          />
        </label>
        <p className={styles.error} role="alert" aria-live="polite">{error}</p>
      </div>
    </DialogShell>
  );
}
