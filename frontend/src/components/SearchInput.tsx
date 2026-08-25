"use client";

import { useEffect, useRef } from "react";

interface SearchInputProps {
  placeholder?: string;
  onSearch: (query: string) => Promise<void> | void;
  style?: React.CSSProperties;
  value?: string;
  ariaLabel?: string;
}

export default function SearchInput({ placeholder = "Search...", onSearch, style, value, ariaLabel }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusKey = ariaLabel || placeholder;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const isFocused = document.activeElement === input;
    const valueChanged = value !== undefined && input.value !== value;
    if (valueChanged) input.value = value;

    if (isFocused && valueChanged && value !== undefined) {
      input.setSelectionRange(value.length, value.length);
    }
  }, [focusKey, value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      onSearch(e.currentTarget.value);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.currentTarget.value.trim()) {
      onSearch("");
    }
  }

  return (
    <div style={{ position: "relative", ...style }}>
      <span aria-hidden="true" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "0.9rem" }}>
        🔍
      </span>
      <input
        ref={inputRef}
        type="text"
        aria-label={focusKey}
        enterKeyHint="search"
        defaultValue={value || ""}
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
