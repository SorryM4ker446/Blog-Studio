"use client";

import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/api";
import EditorSelect from "@/components/editor/EditorSelect";

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
  const [mode, setMode] = useState<"idle" | "create">("idle");
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
    setError("");
    setMode("create");
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
    const message = await onCreate(normalizedName);
    savingRef.current = false;
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setMode("idle");
    setName("");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <EditorSelect
            ariaLabel="Post category"
            value={value}
            disabled={loading || saving || mode !== "idle"}
            onChange={onChange}
            options={[
              { value: 0, label: "无标签 (None)" },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
            onRenameOption={onRename}
            onDeleteOption={onDelete}
            isOptionManageable={(option) => option.value !== 0}
          />
        </div>
        <button type="button" onClick={startCreate} disabled={loading || saving || mode !== "idle"} aria-label="Create category" title="Create category" className="editor-icon-button">+</button>
      </div>

      {mode !== "idle" && (
        <div className="fade-in" style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <label htmlFor="category-name" className="sr-only">
            Category name
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
                setError("");
              }
            }}
            readOnly={saving}
            maxLength={255}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "category-name-error" : undefined}
            placeholder="New category name…"
            style={{ ...fieldStyle, flex: "1 1 240px" }}
          />
          <button type="button" onClick={() => void submitName()} disabled={saving} className="editor-inline-action">
            {saving ? "Saving…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
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
