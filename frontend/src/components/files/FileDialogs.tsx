"use client";

import { getApiErrorMessage } from "@/lib/api-client";
import ModalSurface from "@/components/ModalSurface";

import { formatDateTime } from "@/lib/display-date";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { FileMutationResult, FileRecord, UploadProgress } from "@/lib/api";
import { getDownloadUrl, getFileViewUrl } from "@/lib/api";
import { DownloadIcon, EditIcon, FileTextIcon, PaperclipIcon, UploadIcon } from "@/components/Icons";
import { formatFileSize, getFileLabel } from "./FileCard";
import { getFileTypeLabel, getSelectedFileTypeLabel } from "@/lib/file-type";
import { MAX_UPLOAD_BYTES } from "@/lib/file-upload";
import styles from "./FileDialogs.module.css";

const acceptedFileTypes = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.csv,.json,.zip,.doc,.xls,.ppt,.docx,.xlsx,.pptx";
const acceptedExtensions = new Set(acceptedFileTypes.split(","));
const unsupportedFileMessage = "File extension and content type must match an allowed format";
const displayNameLimit = 25;
const descriptionLimit = 100;
const processingLabelDelayMs = 500;

function characterCount(value: string) {
  return Array.from(value).length;
}

function limitMetadataInput(value: string, previous: string, maximum: number) {
  const characters = Array.from(value);
  if (characters.length <= maximum || (characterCount(previous) > maximum && characters.length < characterCount(previous))) return value;
  return characters.slice(0, maximum).join("");
}

interface DialogShellProps {
  open: boolean;
  title: string;
  eyebrow: string;
  subtitle?: string;
  wide?: boolean;
  panelClassName?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode | ((close: () => void, closing: boolean) => ReactNode);
}

function DialogShell({ open, title, eyebrow, subtitle, wide, panelClassName, busy, onClose, children, footer }: DialogShellProps) {
  const titleId = useId();
  if (!open) return null;
  return <ModalSurface onClose={onClose} busy={busy} labelledBy={titleId} className={`${styles.dialog} ${wide ? styles.wideDialog : ""} ${panelClassName || ""}`}>
    {(close, closing) => <>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" className={styles.close} onClick={close} disabled={busy || closing} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{typeof footer === "function" ? footer(close, closing) : footer}</footer>}
    </>}
  </ModalSurface>;
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
          <dd title={file.mime_type}>{getFileTypeLabel(file.orig_name, file.mime_type)}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Size</dt>
          <dd>{formatFileSize(file.size)}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Uploaded</dt>
          <dd>{formatDateTime(file.created_at)}</dd>
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
  onUpload: (file: File, displayName: string, description: string, onProgress: (progress: UploadProgress | null) => void) => Promise<FileMutationResult>;
}

export function FileUploadDialog({ open, onClose, onUpload }: FileUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadSettledRef = useRef(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [showProcessing, setShowProcessing] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const nameTooLong = characterCount(displayName) > displayNameLimit;
  const descriptionTooLong = characterCount(description) > descriptionLimit;
  const fileTooLarge = selectedFile !== null && selectedFile.size > MAX_UPLOAD_BYTES;
  const unsupportedFile = selectedFile !== null
    && (!acceptedExtensions.has(selectedFile.name.slice(selectedFile.name.lastIndexOf(".")).toLowerCase())
      || errorCode === "unsupported_file_type");
  const progressPercent = uploadProgress && uploadProgress.total > 0
    ? Math.max(0, Math.min(100, Math.floor(uploadProgress.loaded / uploadProgress.total * 100)))
    : 0;
  const uploadedFileBytes = selectedFile && uploadProgress && uploadProgress.total > 0
    ? Math.min(selectedFile.size, Math.round(selectedFile.size * uploadProgress.loaded / uploadProgress.total))
    : 0;

  useEffect(() => {
    if (!saving || progressPercent !== 100) return;
    const timer = window.setTimeout(() => {
      if (!uploadSettledRef.current) setShowProcessing(true);
    }, processingLabelDelayMs);
    return () => window.clearTimeout(timer);
  }, [saving, progressPercent]);

  function chooseFile(file: File | null) {
    if (!file) return;
    setSelectedFile(file);
    setDisplayName(file.name);
    setUploadProgress(null);
    setShowProcessing(false);
    setErrorCode("");
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    setError(file.size > MAX_UPLOAD_BYTES ? "Each file must be 1 GB or smaller."
      : !acceptedExtensions.has(extension) ? unsupportedFileMessage : "");
  }

  async function submit(close: () => void) {
    if (!selectedFile || fileTooLarge || unsupportedFile || !displayName.trim() || nameTooLong || descriptionTooLong || saving) return;
    setSaving(true);
    setUploadProgress(null);
    setShowProcessing(false);
    uploadSettledRef.current = false;
    setError("");
    try {
      const result = await onUpload(selectedFile, displayName.trim(), description.trim(), (progress) => {
        setUploadProgress(progress);
        if (!progress || progress.loaded < progress.total) setShowProcessing(false);
      });
      uploadSettledRef.current = true;
      if (!result.ok) {
        setSaving(false);
        setUploadProgress(null);
        setShowProcessing(false);
        setErrorCode(result.code || "");
        setError(result.error || "Could not upload file");
        return;
      }
      close();
    } catch (error) {
      uploadSettledRef.current = true;
      setSaving(false);
      setUploadProgress(null);
      setShowProcessing(false);
      setError(getApiErrorMessage(error));
    }
  }

  return (
    <DialogShell
      open={open}
      panelClassName={styles.uploadDialog}
      eyebrow="New file"
      title="Upload a file"
      subtitle="Add a clear public name and optional context before publishing it to Drive."
      busy={saving}
      onClose={onClose}
      footer={(close, closing) =>
        <>
          <button type="button" className={styles.button} onClick={close} disabled={saving || closing}>Cancel</button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => void submit(close)}
            disabled={!selectedFile || fileTooLarge || unsupportedFile || !displayName.trim() || nameTooLong || descriptionTooLong || saving || closing}
          >
            {saving ? "Uploading…" : "Upload"}
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
            <div className={styles.selectedFileRow}>
              <span className={styles.selectedIcon} data-file-icon="attachment" aria-hidden="true"><PaperclipIcon size={18} /></span>
              <span className={styles.selectedMeta}>
                <span className={styles.selectedName}>{selectedFile.name}</span>
                <span className={styles.selectedSize}>{formatFileSize(selectedFile.size)} · {getSelectedFileTypeLabel(selectedFile.name, selectedFile.type)}</span>
              </span>
              <button type="button" className={styles.replaceButton} onClick={() => inputRef.current?.click()} disabled={saving}>
                Replace
              </button>
            </div>
            {saving && <div className={styles.uploadProgress}>
              <div className={styles.uploadProgressHeading}>
                <span>{showProcessing ? "Processing file…" : "Uploading file…"}</span>
                <span className={styles.uploadPercent}>{progressPercent}%</span>
              </div>
              <div className={styles.progressTrack} role="progressbar" aria-label="File upload progress"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                <span className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
              </div>
              <span className={styles.progressAmount}>
                {formatFileSize(uploadedFileBytes)} of {formatFileSize(selectedFile.size)}
              </span>
            </div>}
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
                JPG, PNG, GIF, WebP, PDF, TXT, MD, CSV, JSON, ZIP, DOC, XLS, PPT, DOCX, XLSX, or PPTX. Max 1 GB per file.
              </span>
            </span>
          </button>
        )}

        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Display name</span>
            <span className={`${styles.counter} ${nameTooLong ? styles.overLimit : ""}`}>{characterCount(displayName)}/{displayNameLimit}</span>
          </span>
          <input
            className={styles.input}
            data-autofocus
            value={displayName}
            onChange={(event) => setDisplayName(previous => limitMetadataInput(event.target.value, previous, displayNameLimit))}
            placeholder="File name shown in Drive"
            aria-invalid={nameTooLong || undefined}
            disabled={saving}
          />
          <span className={styles.helper}>The original filename remains unchanged for downloads and type validation.</span>
          {nameTooLong && <span className={styles.overLimit}>Shorten the display name to 25 characters before uploading.</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Description</span>
            <span className={`${styles.counter} ${descriptionTooLong ? styles.overLimit : ""}`}>{characterCount(description)}/{descriptionLimit}</span>
          </span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(previous => limitMetadataInput(event.target.value, previous, descriptionLimit))}
            placeholder="What is this file for?"
            aria-invalid={descriptionTooLong || undefined}
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
  const nameTooLong = characterCount(displayName) > displayNameLimit;
  const descriptionTooLong = characterCount(description) > descriptionLimit;

  async function submit(close: () => void) {
    if (!displayName.trim() || nameTooLong || descriptionTooLong || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await onSave(file, displayName.trim(), description.trim());
      if (!result.ok) {
        setSaving(false);
        setError(result.error || "Could not save file details");
        return;
      }
      close();
    } catch (error) {
      setSaving(false);
      setError(getApiErrorMessage(error));
    }
  }

  return (
    <DialogShell
      open
      eyebrow="File settings"
      title="Edit file details"
      subtitle={`Original file: ${file.orig_name}`}
      busy={saving}
      onClose={onClose}
      footer={(close, closing) =>
        <>
          <button type="button" className={styles.button} onClick={close} disabled={saving || closing}>Cancel</button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => void submit(close)}
            disabled={!displayName.trim() || nameTooLong || descriptionTooLong || saving || closing}
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
            <span className={`${styles.counter} ${nameTooLong ? styles.overLimit : ""}`}>{characterCount(displayName)}/{displayNameLimit}</span>
          </span>
          <input
            className={styles.input}
            data-autofocus
            value={displayName}
            onChange={(event) => setDisplayName(previous => limitMetadataInput(event.target.value, previous, displayNameLimit))}
            aria-invalid={nameTooLong || undefined}
            disabled={saving}
          />
          <span className={styles.helper}>Changing this label does not rename the stored file or alter its download type.</span>
          {nameTooLong && <span className={styles.overLimit}>Shorten the display name to 25 characters before saving.</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>Description</span>
            <span className={`${styles.counter} ${descriptionTooLong ? styles.overLimit : ""}`}>{characterCount(description)}/{descriptionLimit}</span>
          </span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(previous => limitMetadataInput(event.target.value, previous, descriptionLimit))}
            aria-invalid={descriptionTooLong || undefined}
            placeholder="Add context for readers"
            disabled={saving}
          />
          {descriptionTooLong && <span className={styles.overLimit}>Shorten the description to 100 characters before saving.</span>}
        </label>
        <p className={styles.error} role="alert" aria-live="polite">{error}</p>
      </div>
    </DialogShell>
  );
}
