"use client";
import { useEffect, useRef } from "react";
import { EditIcon, FileTextIcon, FolderIcon, PaperclipIcon } from "@/components/Icons";
export type EditorTab = "posts" | "files" | "links";
const tabs = ["posts", "files", "links"] as const;
export function EditorHeading() {
  return <header style={{ marginBottom: "2rem" }}><h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: ".8rem", marginBottom: ".5rem" }}><EditIcon size={28} /> Content Editor</h1>
    <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>Manage your posts, cloud drive files, and homepage links.</p></header>;
}
export default function EditorResourceTabs({ activeTab, onChange, counts }: { activeTab: EditorTab; onChange: (tab: EditorTab) => void; counts: Partial<Record<EditorTab, number | null>> }) {
  const focusPending = useRef(false);
  useEffect(() => { if (focusPending.current) { document.getElementById(`editor-${activeTab}-tab`)?.focus({ preventScroll: true }); focusPending.current = false; } }, [activeTab]);
  return <div role="tablist" aria-label="Editor resources" className="editor-tabs editor-tabs-three" data-active-tab={activeTab} onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(activeTab);
    const next = event.key === "Home" ? "posts" : event.key === "End" ? "links" : tabs[(index + (event.key === "ArrowLeft" ? 2 : 1)) % 3];
    focusPending.current = true;
    onChange(next);
    // The tabs can move between resource views during the same navigation.
    requestAnimationFrame(() => document.getElementById(`editor-${next}-tab`)?.focus({ preventScroll: true }));
  }}>
    {tabs.map(tab => {
      const Icon = tab === "posts" ? FileTextIcon : tab === "files" ? FolderIcon : PaperclipIcon;
      return <button key={tab} id={`editor-${tab}-tab`} type="button" role="tab" aria-controls="editor-resource-panel" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1}
        className={activeTab === tab ? "editor-tab editor-tab-active" : "editor-tab"} onClick={() => onChange(tab)}><Icon size={18} />{tab[0].toUpperCase()+tab.slice(1)}{counts[tab] == null ? "" : ` (${counts[tab]})`}</button>;
    })}
  </div>;
}
