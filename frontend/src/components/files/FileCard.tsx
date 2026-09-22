import { formatDate } from "@/lib/display-date";
import type { MouseEventHandler } from "react";
import type { FileRecord } from "@/lib/api";
import { getDownloadUrl } from "@/lib/api";
import { DownloadIcon, EditIcon, PaperclipIcon, TrashIcon } from "@/components/Icons";
import styles from "./FileCard.module.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileLabel(file: FileRecord): string {
  return file.display_name?.trim() || file.orig_name;
}

interface FileCardProps {
  file: FileRecord;
  onPreview: (file: FileRecord) => void;
  onEdit?: (file: FileRecord) => void;
  onDelete?: (file: FileRecord) => void;
  showDescription?: boolean;
}

export function EditActionButton({ onClick, busy = false }: { onClick: MouseEventHandler<HTMLButtonElement>; busy?: boolean }) {
  return (
    <button type="button" className={styles.action} onClick={onClick} disabled={busy} aria-busy={busy}>
      {busy ? <svg className="editor-opening-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" opacity=".2" /><path d="M12 3a9 9 0 0 1 9 9" /></svg> : <EditIcon size={14} />} Edit
    </button>
  );
}

export default function FileCard({ file, onPreview, onEdit, onDelete, showDescription = true }: FileCardProps) {
  const label = getFileLabel(file);

  return (
    <article className={styles.card} data-file-id={file.id}>
      <button
        type="button"
        className={styles.previewButton}
        onClick={() => onPreview(file)}
        aria-label={`Preview ${label}`}
      >
        <span className={styles.icon} aria-hidden="true" data-file-icon="attachment">
          <PaperclipIcon size={18} />
        </span>
        <span className={styles.content}>
          <span className={styles.name}>{label}</span>
          {showDescription && file.description && <span className={styles.description}>{file.description}</span>}
          <span className={styles.meta}>
            {formatSize(file.size)} · {file.mime_type} · {formatDate(file.created_at)}
          </span>
        </span>
      </button>

      <div className={styles.actions}>
        {onEdit && (
          <EditActionButton onClick={() => onEdit(file)} />
        )}
        <a className={styles.action} href={getDownloadUrl(file.id)} download>
          <DownloadIcon size={14} /> Download
        </a>
        {onDelete && (
          <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => onDelete(file)}>
            <TrashIcon size={14} /> Delete
          </button>
        )}
      </div>
    </article>
  );
}
