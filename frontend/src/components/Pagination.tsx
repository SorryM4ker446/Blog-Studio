import React from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  // Generate pagination array with ellipsis
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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.4rem", marginTop: "2rem" }}>
      {/* Prev Button */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="fade-in"
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
          transition: "all 0.2s ease",
          boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      {/* Page Numbers */}
      <div style={{ display: "flex", gap: "0.2rem", margin: "0 0.5rem" }}>
        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} style={{ 
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
              key={`page-${p}`}
              onClick={() => onPageChange(p as number)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                border: isCurrent ? "none" : "1px solid transparent", // Use transparent border so it doesn't jump
                background: isCurrent ? "var(--accent-blue)" : "transparent",
                color: isCurrent ? "#fff" : "var(--text-primary)",
                fontWeight: isCurrent ? 600 : 500,
                fontSize: "0.9rem",
                cursor: "pointer",
                transition: "all 0.2s ease",
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

      {/* Next Button */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="fade-in"
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
          transition: "all 0.2s ease",
          boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </div>
  );
}
