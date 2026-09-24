"use client";

import { SearchIcon } from "./Icons";
import { useEffect, useRef } from "react";

interface SearchInputProps {
  placeholder?: string;
  onSearch: (query: string) => Promise<void> | void;
  style?: React.CSSProperties;
  value?: string;
  ariaLabel?: string;
  variant?: "default" | "editor";
}

export default function SearchInput({ placeholder = "Search...", onSearch, style, value, ariaLabel, variant = "default" }: SearchInputProps) {
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
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      onSearch(e.currentTarget.value);
    }
  }

  return (
    <div className={variant === "editor" ? "editor-search-control" : undefined} style={{ position: "relative", ...style }}>
      {variant === "editor" ? <button type="button" className="editor-search-submit" aria-label="Submit search" onClick={() => void onSearch(inputRef.current?.value ?? "")}>
        <span aria-hidden="true"><SearchIcon size={18} /></span>
      </button> : <span aria-hidden="true" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "0.9rem" }}>
        🔍
      </span>}
      <input
        ref={inputRef}
        type="text"
        aria-label={focusKey}
        enterKeyHint="search"
        defaultValue={value || ""}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={variant === "editor" ? undefined : {
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
