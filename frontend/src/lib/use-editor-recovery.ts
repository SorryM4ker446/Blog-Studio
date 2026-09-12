"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PostSnapshot } from "./post-editor";
import { RECOVERY_TTL, RecoveryWriter, recoveryStorage, openRecoveryChannel, type RecoveryCopy } from "./editor-recovery-store";
import { registerLeaveGuard } from "./editor-navigation";

export interface RecoveryInput {
  userId?: number;
  target: string | null;
  ready: boolean;
  dirty: boolean;
  busy: boolean;
  version: number | null;
  baseline: PostSnapshot;
  fields: PostSnapshot;
  onRestore: (copy: RecoveryCopy) => void;
}
let documentTab: string | undefined;
let tabClaim: Promise<void> | undefined;
function tabIdentity() {
  if (!documentTab) {
    try {
      documentTab = sessionStorage.getItem("blogStudio:recoveryTab") || crypto.randomUUID();
      sessionStorage.setItem("blogStudio:recoveryTab", documentTab);
    } catch { documentTab = crypto.randomUUID(); }
  }
  return documentTab;
}
function claimTab() {
  if (!tabClaim) tabClaim = new Promise<void>(resolve => {
    const candidate = tabIdentity();
    if (!navigator.locks) { documentTab = crypto.randomUUID(); resolve(); return; }
    // sessionStorage can be cloned when a tab is duplicated. Hold an exclusive
    // document-lifetime lock so the duplicate cannot adopt the original owner.
    const acquire = (owner: string) => {
      void navigator.locks.request(`blogStudio:recoveryTab:${owner}`, { ifAvailable: true }, async lock => {
        if (!lock) {
          documentTab = crypto.randomUUID();
          try { sessionStorage.setItem("blogStudio:recoveryTab", documentTab); } catch { /* Ownership still remains document-local. */ }
          acquire(documentTab);
          return;
        }
        resolve();
        await new Promise(() => {});
      }).catch(() => { documentTab = crypto.randomUUID(); resolve(); });
    };
    acquire(candidate);
  });
  return tabClaim;
}

export function useEditorRecovery(input: RecoveryInput) {
  const [copies, setCopies] = useState<RecoveryCopy[]>([]);
  const [checking, setChecking] = useState(Boolean(input.userId && input.target));
  const [error, setError] = useState("");
  const identity = `${input.userId}:${input.target}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity); setChecking(Boolean(input.userId && input.target)); setCopies([]); setError("");
  }
  const live = useRef(input);
  useLayoutEffect(() => { live.current = input; });
  const writer = useRef<RecoveryWriter | null>(null);
  const id = useRef("");
  const adopted = useRef<string[]>([]);
  const decided = useRef(false);
  const suppress = useRef(false);
  const revoked = useRef(false);
  const mounted = useRef(false);
  const reportError = useCallback(() => { if (mounted.current) setError("Browser recovery is unavailable or full. Keep this tab open and save your work to the server, or copy your text before leaving."); }, []);
  const schedule = useCallback(() => {
    const current = live.current;
    if (!writer.current || !current.userId || !current.target || !current.ready || !current.dirty || !decided.current || suppress.current || revoked.current) return;
    const now = Date.now();
    writer.current.schedule({ id: id.current, format: 1, userId: current.userId, target: current.target, tab: tabIdentity(),
      updatedAt: now, expiresAt: now + RECOVERY_TTL, version: current.version, baseline: current.baseline, fields: current.fields });
  }, []);
  const flush = useCallback(async () => { schedule(); await writer.current?.flush(); }, [schedule]);
  const clear = useCallback(async () => {
    suppress.current = true;
    const ids = [id.current, ...adopted.current];
    adopted.current = [];
    id.current = crypto.randomUUID();
    await writer.current?.clear(ids);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!input.userId || !input.target) return;
    let active = true;
    const userId = input.userId, target = input.target;
    decided.current = false; suppress.current = false; revoked.current = false; adopted.current = [];
    id.current = crypto.randomUUID();
    void Promise.all([recoveryStorage.start(userId), recoveryStorage.list(userId, target.startsWith("new:") ? "new:*" : target, () => {
      if (active) setError("Some browser copies expired or could not be read and were removed. Valid copies remain available below.");
    }), claimTab()]).then(([session, rows]) => {
      if (!active || revoked.current) return;
      writer.current = new RecoveryWriter(recoveryStorage, session, () => { if (active) reportError(); });
      adopted.current = rows.filter(copy => copy.tab === tabIdentity() && copy.target === target).map(copy => copy.id);
      setCopies(rows); decided.current = rows.length === 0; setChecking(false);
      schedule();
    }).catch(() => { if (active) { decided.current = true; setChecking(false); reportError(); } });
    return () => {
      active = false;
      // The last render already scheduled a snapshot for this exact identity.
      void writer.current?.flush();
      writer.current = null;
    };
  }, [input.userId, input.target, reportError, schedule]);

  useEffect(() => {
    if (!input.ready || !decided.current) return;
    if (input.dirty) { suppress.current = false; schedule(); }
    else if (writer.current) { void clear(); }
  }, [input.fields.title, input.fields.summary, input.fields.content, input.fields.category_id, input.version, input.ready, input.dirty, schedule, clear]);

  useEffect(() => {
    if (!input.userId || !input.target) return;
    const unregister = registerLeaveGuard({ dirty: () => live.current.dirty, busy: () => live.current.busy, flush,
      expire: async () => { await flush(); writer.current?.cancel(); suppress.current = true; } });
    const hidden = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", hidden);
    const logout = () => { writer.current?.cancel(); suppress.current = true; revoked.current = true; setCopies([]); setChecking(false); };
    const channel = openRecoveryChannel();
    if (channel) channel.onmessage = event => {
      if (event.data?.userId === input.userId && event.data?.action === "logout") {
        logout(); setError("You signed out in another tab. Browser copies were cleared. Copy your text before leaving, or sign in again before saving.");
      }
    };
    window.addEventListener("blog:recovery-logout", logout);
    return () => { unregister(); channel?.close(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("blog:recovery-logout", logout); };
  }, [input.userId, input.target, flush]);

  const restore = (copy: RecoveryCopy) => {
    // A fork owns a fresh key; it never writes into another document's copy.
    if (copy.tab === tabIdentity()) adopted.current.push(copy.id);
    decided.current = true;
    setCopies([]);
    input.onRestore(copy);
  };
  const discard = async () => {
    const owner = writer.current;
    await owner?.clear(copies.map(copy => copy.id));
    if (writer.current !== owner || live.current.userId !== input.userId || live.current.target !== input.target) return;
    setCopies([]); decided.current = true;
    schedule();
  };
  return { copies, checking, error, restore, discard, clear, flush };
}
