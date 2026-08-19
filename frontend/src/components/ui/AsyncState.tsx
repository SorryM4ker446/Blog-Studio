import type { ReactNode } from "react";
import styles from "./AsyncState.module.css";

interface LoadingStateProps {
  label?: string;
  rows?: number;
}

export function LoadingState({ label = "Loading content…", rows = 3 }: LoadingStateProps) {
  return (
    <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.visuallyHidden}>{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={`${styles.skeleton} skeleton-pulse`} aria-hidden="true" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: ReactNode;
}

export function EmptyState({ title, message, icon }: EmptyStateProps) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <div className={styles.content}>
        {icon && <div aria-hidden="true">{icon}</div>}
        <h2 className={styles.title}>{title}</h2>
        {message && <p className={styles.message}>{message}</p>}
      </div>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
}

export function ErrorState({
  title = "Unable to load content",
  message,
  onRetry,
  retryLabel = "Try again",
  retrying = false,
}: ErrorStateProps) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert" aria-live="assertive">
      <div className={styles.content}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>
        {onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry} disabled={retrying}>
            {retrying ? "Trying again…" : retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

interface StatusMessageProps {
  children: ReactNode;
  tone?: "info" | "success" | "error";
  id?: string;
}

export function StatusMessage({ children, tone = "info", id }: StatusMessageProps) {
  const toneClass = tone === "success"
    ? styles.statusSuccess
    : tone === "error"
      ? styles.statusError
      : "";

  return (
    <p
      id={id}
      className={`${styles.status} ${toneClass}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      {children}
    </p>
  );
}
