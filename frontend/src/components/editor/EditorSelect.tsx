"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
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
  const restoringFocusRef = useRef(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const [editingValue, setEditingValue] = useState<T | null>(null);
  const [editName, setEditName] = useState("");
  const [managementError, setManagementError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const menuOpen = open && !disabled;
  const managedOption = options.find(option => option.value === editingValue) ?? options[highlightedIndex];
  const manageable = Boolean(managedOption && (onRenameOption || onDeleteOption) && isOptionManageable(managedOption));

  useLayoutEffect(() => {
    if (!restoringFocusRef.current || disabled || editingValue !== null) return;
    triggerRef.current?.focus({ preventScroll: true });
    restoringFocusRef.current = false;
  }, [disabled, editingValue]);

  useEffect(() => {
    if (!open || disabled) return;
    const menu = menuRef.current?.parentElement;
    const option = menuRef.current?.children[highlightedIndex] as HTMLElement | undefined;
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
    if (savingRef.current || restoringFocusRef.current) return;
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
    triggerRef.current?.focus({ preventScroll: true });
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
      restoringFocusRef.current = true;
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
    if (event.key === "Tab" && (!manageable || event.shiftKey)) closeMenu();
  }

  return (
    <div className="custom-select-container" ref={containerRef} style={{ width }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); }}
      onKeyDown={event => {
        if (event.key === "Escape" && editingValue === null) {
          event.preventDefault(); closeMenu(); triggerRef.current?.focus({ preventScroll: true });
        }
      }}>
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

      <div className="custom-select-options" data-open={menuOpen} aria-hidden={!menuOpen} inert={!menuOpen}
        onMouseDown={event => { if (!(event.target as HTMLElement).closest("button, input")) event.preventDefault(); }}>
        <ul ref={menuRef} id={listboxId} role="listbox" aria-label={ariaLabel} className="custom-select-list">
          {options.map((option, index) => <li
            id={`${listboxId}-option-${index}`} key={String(option.value)} role="option"
            aria-selected={option.value === value}
            className={`custom-select-option${option.value === value ? " active" : ""}${index === highlightedIndex ? " highlighted" : ""}`}
            onPointerMove={() => { if (editingValue === null) setHighlightedIndex(index); }} onClick={() => choose(index)}>
            <span className="custom-select-check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
            <span className="custom-select-option-label">{option.label}</span>
          </li>)}
        </ul>
        {manageable && managedOption && <div className="custom-select-management" role="group" aria-label={`Manage ${managedOption.label}`}>
          {editingValue !== null ? <div className="custom-select-rename">
            <label htmlFor={`${listboxId}-rename`} className="sr-only">New category name</label>
            <input id={`${listboxId}-rename`} autoFocus value={editName} readOnly={saving} maxLength={255}
              aria-invalid={Boolean(managementError)} onChange={event => setEditName(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") { event.preventDefault(); void submitRename(); }
                if (event.key === "Escape" && !saving) {
                  event.preventDefault(); event.stopPropagation(); setEditingValue(null); setManagementError(""); triggerRef.current?.focus({ preventScroll: true });
                }
              }} />
            <button type="button" disabled={saving} onClick={() => void submitRename()} aria-label={`Save ${managedOption.label} rename`}>✓</button>
            <button type="button" disabled={saving} aria-label="Cancel rename" onClick={() => {
              setEditingValue(null); setManagementError(""); triggerRef.current?.focus({ preventScroll: true });
            }}>×</button>
            {managementError && <span role="alert" className="custom-select-option-error">{managementError}</span>}
          </div> : <>
            <span className="custom-select-option-label">{managedOption.label}</span>
            <span className="custom-select-option-actions">
              {onRenameOption && <button type="button" onClick={() => startRename(managedOption)} aria-label={`Rename ${managedOption.label}`} title="Rename category"><EditIcon size={14} /></button>}
              {onDeleteOption && <button type="button" onClick={() => {
                closeMenu(); triggerRef.current?.focus({ preventScroll: true }); onDeleteOption(managedOption.value);
              }} aria-label={`Delete ${managedOption.label}`} title="Delete category" className="custom-select-option-delete"><TrashIcon size={14} /></button>}
            </span>
          </>}
        </div>}
      </div>
    </div>
  );
}
