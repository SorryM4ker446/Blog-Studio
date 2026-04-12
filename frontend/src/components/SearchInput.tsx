"use client";

import { useState } from "react";

interface SearchInputProps {
  placeholder?: string;
  onSearch: (query: string) => Promise<void> | void;
  style?: React.CSSProperties;
}

export default function SearchInput({ placeholder = "Search...", onSearch, style }: SearchInputProps) {
  const [query, setQuery] = useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      onSearch(query);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);
    if (!value.trim()) {
      onSearch("");
    }
  }

  return (
    <div style={{ position: "relative", ...style }}>
      <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "0.9rem" }}>
        🔍
      </span>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-color)",
          borderRadius: "20px",
          padding: "8px 16px 8px 36px",
          color: "var(--text-primary)",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          transition: "border-color 0.2s",
          fontSize: "0.9rem"
        }}
      />
    </div>
  );
}
