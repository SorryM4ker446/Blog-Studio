"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createLink, deleteLink, getAdminLinks, moveLink, updateLink, type HomepageLink, type LinkFields } from "@/lib/links";
import { getApiErrorMessage } from "@/lib/api-client";
import { readPage } from "@/lib/resource-query";
import PaginatedResults from "@/components/PaginatedResults";
import EditorDeleteDialog from "@/components/editor/EditorDeleteDialog";
import { InboxIcon } from "@/components/Icons";
import LinkGrid from "./LinkGrid";
import { EmptyState, ErrorState } from "@/components/ui/AsyncState";
import LinkEditorDialog from "./LinkEditorDialog";
import { LinkCardContent } from "./LinkCard";
import ClampedText from "./ClampedText";
import styles from "./Links.module.css";

export default function useLinksManager(active: boolean, initialLinks: HomepageLink[], initialError: string) {
  const params = useSearchParams();
  const query = params.get("link_q") || "";
  const requestedPage = readPage(params.get("link_page") || "");
  const [links, setLinks] = useState<HomepageLink[]>(initialLinks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [resolved, setResolved] = useState(!initialError);
  const needsRead = useRef(Boolean(initialError));
  const read = useRef<AbortController | null>(null);
  const [wasActive, setWasActive] = useState(active);
  const [animatePages, setAnimatePages] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<{ link: HomepageLink | null } | null>(null);
  const [deleting, setDeleting] = useState<HomepageLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  if (wasActive !== active) {
    setWasActive(active);
    setLoading(active && needsRead.current);
    if (!active) { setEditing(null); setDeleting(null); }
  }
  const live = useRef(true), working = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!active || !needsRead.current) return;
    if (working.current) { setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    read.current = controller;
    getAdminLinks(controller.signal).then(data => { if (!controller.signal.aborted) { needsRead.current = false; setLinks(data); setResolved(true); setError(""); } })
      .catch(err => { if (!controller.signal.aborted) setError(getApiErrorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt, active]);
  const filtered = links.filter(link => `${link.title} ${link.description} ${link.url}`.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const page = Math.min(requestedPage, pages);
  function navigate(search: string, next: number, replace = false) {
    const target = new URLSearchParams(window.location.search);
    if (search) target.set("link_q", search); else target.delete("link_q");
    if (next > 1) target.set("link_page", String(next)); else target.delete("link_page");
    window.history[replace ? "replaceState" : "pushState"](null,"",`/editor?${target}`);
  }
  useEffect(() => { if (active && !loading && !error && page !== requestedPage) navigate(query,page,true); }, [active,loading,error,page,requestedPage,query]);
  function refresh() { if (working.current) return; needsRead.current = true; setLoading(true); setAttempt(n => n+1); }
  const saveBlockedReason = busy ? "Wait for the current link update to finish before saving."
    : loading ? "Wait for links to finish loading before saving."
    : !resolved ? "Close this dialog and retry loading links before saving."
    : !editing?.link && links.length >= 100 ? "You can have up to 100 links. Remove a link before saving a new one." : "";
  async function save(fields: LinkFields, requestID: string) {
    if (!active || !live.current) throw new Error("This link editor is no longer active.");
    if (working.current || saveBlockedReason) throw new Error(saveBlockedReason || "Wait for the current link update to finish before saving.");
    working.current = true; read.current?.abort(); setLoading(false); setBusy(true);
    try {
      const result = editing?.link ? await updateLink(editing.link,fields) : await createLink(fields,requestID);
      if (!live.current) return;
      setLinks(current => [...current.filter(item => item.id !== result.id),result].sort((a,b) => a.position-b.position || a.id-b.id));
    } catch (err) { needsRead.current = true; throw err; }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function move(link: HomepageLink, neighbor: HomepageLink) {
    if (working.current || loading) return;
    working.current = true; read.current?.abort(); setLoading(false); setBusy(true); setError("");
    try { const result = await moveLink(link,neighbor); if (live.current) { needsRead.current = false; setLinks(result); } }
    catch (err) { needsRead.current = true; if (live.current) setError(getApiErrorMessage(err)); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function remove() {
    if (!deleting || working.current) return;
    working.current = true; read.current?.abort(); setLoading(false); setBusy(true); setDeleteError("");
    try { await deleteLink(deleting); if (live.current) { setLinks(items => items.filter(item => item.id !== deleting.id)); setDeleting(null); } }
    catch (err) { needsRead.current = true; if (live.current) setDeleteError(getApiErrorMessage(err)); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  return {
    query, loading, error, count: resolved ? links.length : null,
    search: (value: string) => navigate(value.trim(), 1),
    toolbar: <button type="button" className="editor-primary-action" disabled={resolved && links.length >= 100} onClick={() => { setEditing({link:null}); }}>+ New Link</button>,
    content: <>
    {error && <ErrorState title="Links could not be updated" message={error} onRetry={refresh} retrying={loading} />}
    {loading && !resolved && <p className={styles.hint} role="status">Loading links…</p>}
    {!error && resolved && !filtered.length ? <EmptyState
      title={query ? "No matching links" : "No links yet"}
      message={query ? "Try a different search term." : "Create a link to get started."}
      icon={<InboxIcon size={54} />}
    /> : <PaginatedResults page={page} totalPages={pages} resultKey={String(page)} pending={loading || busy}
      transitionGroup={query} animateChanges={animatePages} onPageChange={next => { setAnimatePages(true); navigate(query,next); }}>
    <LinkGrid order={filtered.slice((page-1)*8,page*8).map(link => link.id)}>{filtered.slice((page-1)*8,page*8).map(link => {
      const index = links.findIndex(item => item.id === link.id);
      return <article className={styles.row} data-link-id={link.id} key={link.id} aria-label={link.title}><div className={styles.status}>{link.visible ? "Visible" : link.url ? "Hidden" : "Needs a URL"}</div><LinkCardContent link={link} /><ClampedText paragraph className={styles.url} text={link.url || "Set a destination before enabling this link."} />
        <div className={styles.actions}><button className={styles.button} aria-disabled={busy || loading} onClick={() => { if (!working.current && !loading) setEditing({link}); }}>Edit</button>
          <button className={styles.button} aria-disabled={busy || loading} disabled={index === 0 || Boolean(query)} aria-label={`Move ${link.title} earlier`} onClick={() => void move(link,links[index-1])}>←</button>
          <button className={styles.button} aria-disabled={busy || loading} disabled={index === links.length-1 || Boolean(query)} aria-label={`Move ${link.title} later`} onClick={() => void move(link,links[index+1])}>→</button>
          <button className={`${styles.button} ${styles.danger}`} aria-disabled={busy || loading} onClick={() => { if (working.current || loading) return; setDeleting(link); setDeleteError(""); }}>Delete</button></div></article>;
    })}</LinkGrid>
    </PaginatedResults>}
    </>,
    dialogs: <>
  {editing && <LinkEditorDialog key={editing.link?.id ?? "new"} link={editing.link} blockedReason={saveBlockedReason} onSave={save} onClose={() => setEditing(null)} />}
  <EditorDeleteDialog open={Boolean(deleting)} resourceType="link" busy={busy} blocked={false} error={deleteError} onConfirm={() => void remove()} onCancel={() => { if (!working.current) setDeleting(null); }} />
  </>,
  };
}
