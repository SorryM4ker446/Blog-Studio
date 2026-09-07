"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronDownIcon, EditIcon, TrashIcon } from "@/components/Icons";

type SelectValue = string | number;

export interface EditorSelectOption<T extends SelectValue> {
  value: T;
  label: string;
}

interface EditorSelectProps<T extends SelectValue> {
  value: T;
  options: EditorSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  unavailableLabel?: string;
  disabled?: boolean;
  width?: string;
  onRenameOption?: (value: T, name: string) => Promise<string | null>;
  onDeleteOption?: (value: T) => void;
  isOptionManageable?: (option: EditorSelectOption<T>) => boolean;
}

export default function EditorSelect<T extends SelectValue>({
  value,
  options,
  onChange,
  ariaLabel,
  unavailableLabel = "Unavailable selection",
  disabled = false,
  width = "100%",
  onRenameOption,
  onDeleteOption,
  isOptionManageable = () => true,
}: EditorSelectProps<T>) {
  const reactId = useId().replace(/:/g, "");
  const listboxId = `editor-select-${reactId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const savingRef = useRef(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const [editingValue, setEditingValue] = useState<T | null>(null);
  const [editName, setEditName] = useState("");
  const [managementError, setManagementError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const menuOpen = open && !disabled;

  useEffect(() => {
    if (!open || disabled) return;
    const menu = menuRef.current;
    const option = menu?.children[highlightedIndex] as HTMLElement | undefined;
    if (!menu || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [open, disabled, highlightedIndex, options]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node) && !savingRef.current) closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function openMenu(index = selectedIndex) {
    if (disabled || options.length === 0) return;
    setHighlightedIndex(index);
    setOpen(true);
  }

  function closeMenu() {
    if (savingRef.current) return;
    setOpen(false);
    setEditingValue(null);
    setEditName("");
    setManagementError("");
  }

  function choose(index: number) {
    if (editingValue !== null || savingRef.current) return;
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setHighlightedIndex(index);
    closeMenu();
    triggerRef.current?.focus();
  }

  function startRename(option: EditorSelectOption<T>) {
    setEditingValue(option.value);
    setEditName(option.label);
    setManagementError("");
  }

  async function submitRename() {
    if (editingValue === null || !onRenameOption || savingRef.current) return;
    const normalizedName = editName.trim();
    if (!normalizedName) {
      setManagementError("Category name is required.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setManagementError("");
    try {
      const message = await onRenameOption(editingValue, normalizedName);
      if (message) {
        setManagementError(message);
        return;
      }
      setEditingValue(null);
      setEditName("");
    } catch {
      setManagementError("Failed to rename category.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function moveHighlight(offset: number) {
    if (options.length === 0) return;
    setHighlightedIndex((current) => (current + offset + options.length) % options.length);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(selectedIndex);
      else moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setHighlightedIndex(0);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setHighlightedIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(highlightedIndex);
      else openMenu();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab") closeMenu();
  }

  return (
    <div className="custom-select-container" ref={containerRef} style={{ width }}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={menuOpen}
        aria-invalid={!selectedOption || undefined}
        aria-controls={listboxId}
        aria-activedescendant={menuOpen ? `${listboxId}-option-${highlightedIndex}` : undefined}
        disabled={disabled}
        className="custom-select-trigger"
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
      >
        <span className="custom-select-value">{selectedOption?.label ?? unavailableLabel}</span>
        <span className="custom-select-arrow" aria-hidden="true"><ChevronDownIcon size={16} /></span>
      </button>

      <ul
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        aria-hidden={!menuOpen}
        inert={!menuOpen}
        data-open={menuOpen}
        className="custom-select-options"
      >
        {options.map((option, index) => {
          const manageable = Boolean((onRenameOption || onDeleteOption) && isOptionManageable(option));
          const editing = editingValue === option.value;
          return (
            <li
              id={`${listboxId}-option-${index}`}
              key={String(option.value)}
              role="option"
              aria-selected={option.value === value}
              aria-busy={editing && saving}
              className={`custom-select-option${option.value === value ? " active" : ""}${index === highlightedIndex ? " highlighted" : ""}`}
              onPointerMove={() => setHighlightedIndex(index)}
              onClick={() => choose(index)}
            >
              {editing ? (
                <div className="custom-select-rename" onClick={(event) => event.stopPropagation()}>
                  <label htmlFor={`${listboxId}-rename`} className="sr-only">New category name</label>
                  <input
                    id={`${listboxId}-rename`}
                    autoFocus
                    value={editName}
                    readOnly={saving}
                    maxLength={255}
                    aria-invalid={Boolean(managementError)}
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitRename();
                      }
                      if (event.key === "Escape" && !saving) {
                        event.preventDefault();
                        setEditingValue(null);
                        setManagementError("");
                        triggerRef.current?.focus();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void submitRename()} disabled={saving} aria-label={`Save ${option.label} rename`}>✓</button>
                  <button
                    type="button"
                    disabled={saving}
                    aria-label="Cancel rename"
                    onClick={() => {
                      setEditingValue(null);
                      setManagementError("");
                      triggerRef.current?.focus();
                    }}
                  >
                    ×
                  </button>
                  {managementError && <span role="alert" className="custom-select-option-error">{managementError}</span>}
                </div>
              ) : (
                <>
                  <span className="custom-select-check" aria-hidden="true">
                    {option.value === value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>}
                  </span>
                  <span className="custom-select-option-label">{option.label}</span>
                  {manageable && (
                    <span className="custom-select-option-actions" onClick={(event) => event.stopPropagation()}>
                      {onRenameOption && (
                        <button type="button" onClick={() => startRename(option)} aria-label={`Rename ${option.label}`} title="Rename category">
                          <EditIcon size={14} />
                        </button>
                      )}
                      {onDeleteOption && (
                        <button
                          type="button"
                          onClick={() => {
                            closeMenu();
                            onDeleteOption(option.value);
                          }}
                          aria-label={`Delete ${option.label}`}
                          title="Delete category"
                          className="custom-select-option-delete"
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
