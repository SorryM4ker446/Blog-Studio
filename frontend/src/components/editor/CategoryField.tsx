"use client";

import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/api";
import { EditIcon, TrashIcon } from "@/components/Icons";

interface CategoryFieldProps {
  categories: Category[];
  value: number;
  loading?: boolean;
  onChange: (value: number) => void;
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: number, name: string) => Promise<string | null>;
  onDelete: (id: number) => void;
}

const fieldStyle = {
  minHeight: "38px",
  background: "var(--bg-base)",
  border: "1px solid var(--border-color)",
  borderRadius: "8px",
  color: "var(--text-primary)",
  padding: "0.55rem 0.75rem",
  font: "inherit",
} as const;

export default function CategoryField({ categories, value, loading = false, onChange, onCreate, onRename, onDelete }: CategoryFieldProps) {
  const selected = categories.find((category) => category.id === value);
  const [mode, setMode] = useState<"idle" | "create" | "rename">("idle");
  const [renameTargetId, setRenameTargetId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (mode !== "idle") inputRef.current?.focus();
  }, [mode]);

  function startCreate() {
    setName("");
    setRenameTargetId(null);
    setError("");
    setMode("create");
  }

  function startRename() {
    if (!selected) return;
    setName(selected.name);
    setRenameTargetId(selected.id);
    setError("");
    setMode("rename");
  }

  async function submitName() {
    if (savingRef.current) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Category name is required.");
      inputRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    let message: string | null;
    if (mode === "rename") {
      if (renameTargetId === null) {
        savingRef.current = false;
        setSaving(false);
        setError("The category being renamed is no longer available.");
        return;
      }
      message = await onRename(renameTargetId, normalizedName);
    } else {
      message = await onCreate(normalizedName);
    }
    savingRef.current = false;
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setMode("idle");
    setRenameTargetId(null);
    setName("");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <select
          id="post-category"
          aria-label="Post category"
          value={value}
          disabled={loading || saving || mode === "rename"}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ ...fieldStyle, flex: "1 1 240px" }}
        >
          <option value={0}>无标签 (None)</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button type="button" onClick={startCreate} disabled={loading || saving || mode !== "idle"} aria-label="Create category" title="Create category" className="editor-icon-button">+</button>
        <button
          type="button"
          onClick={startRename}
          disabled={loading || saving || mode !== "idle" || !selected}
          aria-label={selected ? `Rename ${selected.name}` : "Select a category to rename"}
          title="Rename selected category"
          className="editor-icon-button"
        >
          <EditIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => selected && onDelete(selected.id)}
          disabled={loading || saving || mode !== "idle" || !selected}
          aria-label={selected ? `Delete ${selected.name}` : "Select a category to delete"}
          title="Delete selected category"
          className="editor-icon-button editor-icon-button-danger"
        >
          <TrashIcon size={16} />
        </button>
      </div>

      {mode !== "idle" && (
        <div className="fade-in" style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <label htmlFor="category-name" className="sr-only">
            {mode === "rename" ? "New category name" : "Category name"}
          </label>
          <input
            ref={inputRef}
            id="category-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !saving) {
                event.preventDefault();
                void submitName();
              }
              if (event.key === "Escape" && !saving) {
                setMode("idle");
                setRenameTargetId(null);
                setError("");
              }
            }}
            readOnly={saving}
            maxLength={255}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "category-name-error" : undefined}
            placeholder={mode === "rename" ? "Rename category…" : "New category name…"}
            style={{ ...fieldStyle, flex: "1 1 240px" }}
          />
          <button type="button" onClick={() => void submitName()} disabled={saving} className="editor-inline-action">
            {saving ? "Saving…" : mode === "rename" ? "Rename" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setRenameTargetId(null);
              setError("");
            }}
            disabled={saving}
            className="editor-inline-action editor-inline-action-secondary"
          >
            Cancel
          </button>
        </div>
      )}
      <p
        id="category-name-error"
        role="alert"
        aria-live="polite"
        style={{ color: "var(--accent-red)", minHeight: error ? "1.2rem" : 0, margin: error ? "0.5rem 0 0" : 0, fontSize: "0.82rem" }}
      >
        {error}
      </p>
    </div>
  );
}
