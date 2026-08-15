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

export function EditActionButton({ onClick }: { onClick: MouseEventHandler<HTMLButtonElement> }) {
  return (
    <button type="button" className={styles.action} onClick={onClick}>
      <EditIcon size={14} /> Edit
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
            {formatSize(file.size)} · {file.mime_type} · {new Date(file.created_at).toLocaleDateString()}
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
