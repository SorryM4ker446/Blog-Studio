"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createLink, deleteLink, getAdminLinks, moveLink, swapLinkPositions, updateLink, type HomepageLink, type LinkFields } from "@/lib/links";
import { getApiErrorMessage } from "@/lib/api-client";
import { readPage } from "@/lib/resource-query";
import EditorPageLayout from "@/components/editor/EditorPageLayout";
import PaginatedResults from "@/components/PaginatedResults";
import EditorDeleteDialog from "@/components/editor/EditorDeleteDialog";
import { InboxIcon, PlusIcon } from "@/components/Icons";
import EditorRowActions from "@/components/editor/EditorRowActions";
import highlightStyles from "@/components/editor/EditorRowHighlight.module.css";
import LinkGrid from "./LinkGrid";
import { EmptyState, ErrorState } from "@/components/ui/AsyncState";
import LinkEditorDialog from "./LinkEditorDialog";
import { LinkCardContent } from "./LinkCard";
import ClampedText from "./ClampedText";
import styles from "./Links.module.css";

function OrderNumber({ link, position, total, disabled, dimmed, onMove }: { link: HomepageLink; position: number; total: number; disabled: boolean; dimmed: boolean; onMove: (position: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(position));
  const [emptySubmitted, setEmptySubmitted] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const settled = useRef(false);
  const restoreFocus = useRef(false);
  const target = Number(value);
  const validTarget = /^[0-9]+$/.test(value) && Number.isInteger(target) && target >= 1 && target <= total;
  const invalid = editing && (value === "" ? emptySubmitted : !validTarget);
  useEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select(); }
    else if (restoreFocus.current) { button.current?.focus(); restoreFocus.current = false; }
  }, [editing]);
  function start() { settled.current = false; setValue(String(position)); setEmptySubmitted(false); setEditing(true); }
  function commit() {
    if (settled.current) return;
    if (!validTarget) { if (value === "") setEmptySubmitted(true); return; }
    settled.current = true;
    setEditing(false); setEmptySubmitted(false);
    if (target !== position) onMove(target);
  }
  function cancel(restore = false) { settled.current = true; restoreFocus.current = restore; setEditing(false); setEmptySubmitted(false); }
  return <span className={styles.orderNumberSlot} data-order-editing={editing || undefined}>
    <button ref={button} type="button" className={styles.orderNumber} disabled={disabled || editing} data-dimmed={dimmed || undefined} aria-label={`Change position of ${link.title}, currently ${position}`} title="Change position" onClick={start}>{String(position).padStart(2, "0")}</button>
    <input ref={input} className={styles.orderInput} type="text" inputMode="numeric" pattern="[0-9]*" disabled={!editing} value={value} aria-label={`New position for ${link.title}, from 1 to ${total}`} aria-invalid={invalid} onChange={event => { setValue(event.target.value); setEmptySubmitted(false); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(true); } }} onBlur={() => { if (settled.current) return; if (validTarget) commit(); else cancel(); }} />
  </span>;
}

export default function useLinksManager(active: boolean, initialLinks: HomepageLink[], initialError: string) {
  const params = useSearchParams();
  const query = params.get("link_q") || "";
  const requestedPage = readPage(params.get("link_page") || "");
  const grid = useRef<LinkGrid>(null);
  const [boundary, setBoundary] = useState<{ id: number; direction: number; swap: boolean }>();
  const [samePageSwap, setSamePageSwap] = useState<{ sourceId: number; targetId: number; direction: number }>();
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
  const [openActions, setOpenActions] = useState<number | null>(null);
  if (wasActive !== active) {
    setWasActive(active);
    setLoading(active && needsRead.current);
    if (!active) { setEditing(null); setDeleting(null); setOpenActions(null); }
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
  const pageLinks = filtered.slice((page - 1) * 8, page * 8);
  const orderUnavailable = Boolean(query) || links.length < 2;
  function navigate(search: string, next: number, replace = false) {
    setOpenActions(null);
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
  async function move(link: HomepageLink, target: HomepageLink, direct = false) {
    if (working.current || loading) return;
    setOpenActions(null);
    working.current = true; read.current?.abort(); setLoading(false); setBusy(true); setError("");
    try {
      const result = direct ? await swapLinkPositions(link,target) : await moveLink(link,target);
      const from = links.findIndex(item => item.id === link.id);
      const to = links.findIndex(item => item.id === target.id);
      const crossesPage = Math.floor(from / 8) !== Math.floor(to / 8);
      const direction = Math.sign(to - from);
      const incoming = crossesPage ? direct ? target : links[direction > 0 ? page * 8 : (page - 1) * 8 - 1] : null;
      if (live.current && crossesPage) await grid.current?.exitBoundary(link.id, direction, direct);
      if (live.current && !crossesPage) await grid.current?.exitSamePageSwap(link.id, target.id, direction);
      if (live.current) {
        needsRead.current = false;
        if (incoming) setBoundary({ id: incoming.id, direction, swap: direct });
        else setSamePageSwap({ sourceId: link.id, targetId: target.id, direction });
        setLinks(result);
      }
    }
    catch (err) { needsRead.current = true; if (live.current) setError(getApiErrorMessage(err)); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function remove() {
    if (!deleting || working.current) return;
    setOpenActions(null);
    working.current = true; read.current?.abort(); setLoading(false); setBusy(true); setDeleteError("");
    try { await deleteLink(deleting); if (live.current) { setLinks(items => items.filter(item => item.id !== deleting.id)); setDeleting(null); } }
    catch (err) { needsRead.current = true; if (live.current) setDeleteError(getApiErrorMessage(err)); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  return {
    query, loading, error, count: resolved ? filtered.length : null,
    search: (value: string) => navigate(value.trim(), 1),
    toolbar: <button type="button" className="editor-primary-action" disabled={resolved && links.length >= 100} onClick={() => { setEditing({link:null}); }}><PlusIcon size={16} /> New Link</button>,
    content: <>
    {error && <ErrorState title="Links could not be updated" message={error} onRetry={refresh} retrying={loading} />}
    {loading && !resolved && <p className={styles.hint} role="status">Loading links…</p>}
    {!error && resolved && !filtered.length ? <EmptyState
      title={query ? "No matching links" : "No links yet"}
      message={query ? "Try a different search term." : "Create a link to get started."}
      icon={<InboxIcon size={54} />}
    /> : <EditorPageLayout resource="links" count={Math.min(8, filtered.length)} pages={pages}><PaginatedResults stablePageHeight allowOverflow page={page} totalPages={pages} resultKey={String(page)} pending={loading || busy}
      transitionGroup={query} animateChanges={animatePages} onPageChange={next => { setAnimatePages(true); navigate(query,next); }}>
    <div className={styles.list} data-editor-links-list>
      <div className={styles.header} aria-hidden="true"><span>Link &amp; Description</span><span>Destination</span><span>Status</span><span>Order</span><span>Actions</span></div>
    <LinkGrid ref={grid} boundary={boundary} samePageSwap={samePageSwap} order={pageLinks.map(link => link.id)}>{pageLinks.map(link => {
      const index = links.findIndex(item => item.id === link.id);
      return <article className={`${styles.row} ${highlightStyles.row} ${openActions === link.id ? highlightStyles.active : ""}`} data-link-id={link.id} key={link.id} aria-label={link.title}>
        <div className={styles.linkInfo}><LinkCardContent link={link} /></div>
        <div className={styles.meta}><ClampedText paragraph className={styles.url} text={link.url || "Set a destination before enabling this link."} />
          <span className={styles.status} data-state={link.visible ? "visible" : link.url ? "hidden" : "missing"}>{link.visible ? "Visible" : link.url ? "Hidden" : "Needs a URL"}</span></div>
        <div className={styles.order} aria-label={`Position ${index + 1}`}>
          <button type="button" className={styles.moveButton} aria-disabled={busy || loading} disabled={index === 0 || Boolean(query)} aria-label={`Move ${link.title} earlier`} onClick={() => void move(link, links[index - 1])}>←</button>
          <OrderNumber link={link} position={index + 1} total={links.length} disabled={busy || loading || orderUnavailable} dimmed={orderUnavailable} onMove={target => void move(link, links[target - 1], true)} />
          <button type="button" className={styles.moveButton} aria-disabled={busy || loading} disabled={index === links.length - 1 || Boolean(query)} aria-label={`Move ${link.title} later`} onClick={() => void move(link, links[index + 1])}>→</button>
        </div>
        <div className={styles.moreCell}><EditorRowActions label={link.title} open={openActions === link.id} unavailable={busy || loading}
          onToggle={() => setOpenActions(current => current === link.id ? null : link.id)} onClose={() => setOpenActions(null)}
          onEdit={() => { if (!working.current && !loading) setEditing({ link }); }}
          onDelete={() => { if (working.current || loading) return; setDeleting(link); setDeleteError(""); }} /></div>
      </article>;
    })}</LinkGrid></div>
    </PaginatedResults></EditorPageLayout>}
    </>,
    dialogs: <>
  {editing && <LinkEditorDialog key={editing.link?.id ?? "new"} link={editing.link} blockedReason={saveBlockedReason} onSave={save} onClose={() => setEditing(null)} />}
  <EditorDeleteDialog open={Boolean(deleting)} resourceType="link" busy={busy} blocked={false} error={deleteError} onConfirm={() => void remove()} onCancel={() => { if (!working.current) setDeleting(null); }} />
  </>,
  };
}
