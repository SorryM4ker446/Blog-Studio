import React from "react";
import styles from "./Pagination.module.css";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pending?: boolean;
  edgeArrows?: boolean;
}

export default function Pagination({ currentPage, totalPages, onPageChange, pending = false, edgeArrows = false }: PaginationProps) {
  if (totalPages <= 1) return null;

  const getPages = () => {
    const pages: (number | string)[] = [];
    
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 4) {
        pages.push(1, 2, 3, 4, 5, "...", totalPages);
      } else if (currentPage > 4 && currentPage < totalPages - 3) {
        pages.push(1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages);
      } else {
        pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      }
    }
    return pages;
  };

  const pages = getPages();

  return (
    <nav className={edgeArrows ? styles.edges : undefined} aria-busy={pending} aria-label="Pagination" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.4rem", marginTop: "2rem" }}>
      <button
        type="button"
        onClick={() => { if (!pending) onPageChange(currentPage - 1); }}
        disabled={pending || currentPage <= 1}
        aria-label="Previous page"
        className={styles.previous}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          border: "1px solid var(--border-color)",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          cursor: currentPage === 1 ? "not-allowed" : "pointer",
          opacity: currentPage === 1 ? 0.3 : 1,
          transition: "background-color 160ms ease, border-color 160ms ease, color 160ms ease",
          boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <div style={{ display: "flex", gap: "0.2rem", margin: "0 0.5rem" }}>
        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} aria-hidden="true" style={{
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                width: "36px", 
                color: "var(--text-muted)",
                letterSpacing: "2px"
              }}>
                ...
              </span>
            );
          }
          
          const isCurrent = p === currentPage;
          return (
            <button
              type="button"
              key={`page-${p}`}
              onClick={() => { if (!pending && !isCurrent) onPageChange(p as number); }}
              disabled={pending}
              aria-label={isCurrent ? `Page ${p}, current page` : `Go to page ${p}`}
              aria-current={isCurrent ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                border: isCurrent ? "none" : "1px solid transparent", // Use transparent border so it doesn't jump
                background: isCurrent ? "var(--accent-blue)" : "transparent",
                color: isCurrent ? "var(--accent-contrast-text)" : "var(--text-primary)",
                fontWeight: isCurrent ? 600 : 500,
                fontSize: "0.9rem",
                cursor: "pointer",
                transition: "background-color 160ms ease, border-color 160ms ease, color 160ms ease",
                boxShadow: isCurrent ? "0 4px 12px rgba(168, 199, 250, 0.3)" : "none",
              }}
              onMouseEnter={(e) => {
                if (!isCurrent) {
                  e.currentTarget.style.background = "var(--bg-surface)";
                  e.currentTarget.style.borderColor = "var(--border-color)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isCurrent) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }
              }}
            >
              {p}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => { if (!pending) onPageChange(currentPage + 1); }}
        disabled={pending || currentPage >= totalPages}
        aria-label="Next page"
        className={styles.next}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          border: "1px solid var(--border-color)",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          cursor: currentPage === totalPages ? "not-allowed" : "pointer",
          opacity: currentPage === totalPages ? 0.3 : 1,
          transition: "background-color 160ms ease, border-color 160ms ease, color 160ms ease",
          boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </nav>
  );
}
