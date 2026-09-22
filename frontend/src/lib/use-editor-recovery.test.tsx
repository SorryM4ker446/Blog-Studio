import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recoveryStorage, RECOVERY_TTL, type RecoveryCopy } from "./editor-recovery-store";
import { useEditorRecovery, type RecoveryInput } from "./use-editor-recovery";
import { preserveExpiredEditor } from "./editor-navigation";

const baseline = { title: "Saved", summary: "", content: "Saved body", category_id: 0 };
const fields = { ...baseline, content: "Recovered body" };
const initial: RecoveryInput = { userId: 1, target: "post:7", ready: true, dirty: false, busy: false, version: 1, baseline, fields: baseline, onRestore: vi.fn() };
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
async function seed() {
  const now = Date.now();
  const copy: RecoveryCopy = { id: "source", format: 1, userId: 1, tab: "another-tab", target: "post:7", version: 1, baseline, fields, updatedAt: now, expiresAt: now + RECOVERY_TTL };
  await recoveryStorage.put(await recoveryStorage.start(1), copy); return copy;
}
it("offers recovery without restoring or writing before an explicit choice", async () => {
  const copy = await seed(); const onRestore = vi.fn();
  const { result, rerender } = renderHook((props: RecoveryInput) => useEditorRecovery(props), { initialProps: { ...initial, onRestore } });
  await waitFor(() => expect(result.current.copies).toHaveLength(1));
  expect(onRestore).not.toHaveBeenCalled();
  await act(async () => result.current.restore(copy));
  expect(onRestore).toHaveBeenCalledWith(copy);
  rerender({ ...initial, onRestore, dirty: true, fields });
  await act(async () => result.current.flush());
  const copies = await recoveryStorage.list(1, "post:7");
  expect(copies).toHaveLength(2); expect(new Set(copies.map(row => row.id)).size).toBe(2);
  await act(async () => result.current.clear());
  expect(await recoveryStorage.list(1, "post:7")).toEqual([copy]);
});
it("discards selected records without changing the server baseline or calling restore", async () => {
  await seed(); const onRestore = vi.fn();
  const { result } = renderHook(() => useEditorRecovery({ ...initial, onRestore }));
  await waitFor(() => expect(result.current.copies).toHaveLength(1));
  await act(async () => result.current.discard());
  expect(result.current.copies).toEqual([]); expect(onRestore).not.toHaveBeenCalled();
  expect(await recoveryStorage.list(1, "post:7")).toEqual([]);
});
it("keeps recovery choices available when discard fails and allows retry", async () => {
  const copy = await seed();
  const view = renderHook(() => useEditorRecovery(initial));
  await waitFor(() => expect(view.result.current.copies).toHaveLength(1));
  vi.spyOn(recoveryStorage, "remove").mockRejectedValueOnce(new Error("Storage unavailable"));
  await act(() => view.result.current.discard());
  expect(view.result.current.copies).toEqual([copy]);
  expect(view.result.current.error).toContain("unavailable");
  await act(() => view.result.current.discard());
  expect(view.result.current.copies).toEqual([]);
  expect(await recoveryStorage.list(1, "post:7")).toEqual([]);
});

it("clears only the restored same-tab copy and keeps unselected copies", async () => {
  const first = renderHook(() => useEditorRecovery({ ...initial, dirty: true, fields }));
  await waitFor(() => expect(first.result.current.checking).toBe(false));
  await act(() => first.result.current.flush());
  const [original] = await recoveryStorage.list(1, "post:7");
  first.unmount();
  const other = { ...original, id: "another-same-tab-copy", fields: { ...fields, content: "Keep this alternative" } };
  await recoveryStorage.put(await recoveryStorage.start(1), other);
  const view = renderHook(() => useEditorRecovery(initial));
  await waitFor(() => expect(view.result.current.copies).toHaveLength(2));
  act(() => view.result.current.restore(original));
  await act(() => view.result.current.clear());
  expect(await recoveryStorage.list(1, "post:7")).toEqual([other]);
});
it("keeps this tab's previous copy when continuing and saving the current version", async () => {
  const first = renderHook(() => useEditorRecovery({ ...initial, dirty: true, fields }));
  await waitFor(() => expect(first.result.current.checking).toBe(false));
  await act(() => first.result.current.flush());
  const [original] = await recoveryStorage.list(1, "post:7");
  first.unmount();
  const onRestore = vi.fn();
  const next = renderHook((props: RecoveryInput) => useEditorRecovery(props), { initialProps: { ...initial, onRestore } });
  await waitFor(() => expect(next.result.current.copies).toHaveLength(1));
  act(() => next.result.current.continueWithoutRestoring());
  expect(next.result.current.copies).toEqual([]);
  expect(onRestore).not.toHaveBeenCalled();
  next.rerender({ ...initial, onRestore, dirty: true, fields: { ...baseline, content: "New edit" } });
  await act(() => next.result.current.flush());
  expect(await recoveryStorage.list(1, "post:7")).toHaveLength(2);
  await act(() => next.result.current.clear());
  expect(await recoveryStorage.list(1, "post:7")).toEqual([original]);
  next.unmount();
  const reopened = renderHook(() => useEditorRecovery(initial));
  await waitFor(() => expect(reopened.result.current.copies).toEqual([original]));
});
it("does not expose another user's copies and reports unavailable storage", async () => {
  await seed();
  const { result, unmount } = renderHook(() => useEditorRecovery({ ...initial, userId: 2 }));
  await waitFor(() => expect(result.current.checking).toBe(false)); expect(result.current.copies).toEqual([]); unmount();
  vi.stubGlobal("indexedDB", { open: () => { throw new Error("Disabled"); } });
  const unavailable = renderHook(() => useEditorRecovery(initial));
  await waitFor(() => expect(unavailable.result.current.error).toContain("unavailable"));
  expect(unavailable.result.current.checking).toBe(false);
});
it("cancels a pending write when logout arrives before the throttle fires", async () => {
  const { result, rerender } = renderHook((props: RecoveryInput) => useEditorRecovery(props), { initialProps: initial });
  await waitFor(() => expect(result.current.checking).toBe(false));
  rerender({ ...initial, dirty: true, fields });
  await act(async () => { window.dispatchEvent(new Event("blog:recovery-logout")); await result.current.flush(); });
  expect(await recoveryStorage.list(1, "post:7")).toEqual([]);
});
it("ignores late discovery after switching to another article and flushes only its own pending identity", async () => {
  let resolve!: (rows: RecoveryCopy[]) => void;
  const old = await seed();
  const read = vi.spyOn(recoveryStorage, "list").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result, rerender } = renderHook((props: RecoveryInput) => useEditorRecovery(props), { initialProps: initial });
  rerender({ ...initial, target: "post:8" });
  await waitFor(() => expect(result.current.checking).toBe(false));
  await act(async () => resolve([old])); expect(result.current.copies).toEqual([]);
  rerender({ ...initial, target: "post:8", fields, dirty: true });
  await act(async () => result.current.flush());
  expect(await recoveryStorage.list(1, "post:7")).toEqual([old]);
  expect(await recoveryStorage.list(1, "post:8")).toHaveLength(1);
  read.mockRestore();
});
it("does not let an old discard dismiss a different article's recovery choices", async () => {
  await seed();
  const other = { ...(await recoveryStorage.list(1, "post:7"))[0], id: "other", target: "post:8" };
  await recoveryStorage.put(await recoveryStorage.start(1), other);
  let finish!: () => void;
  vi.spyOn(recoveryStorage, "remove").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook((props: RecoveryInput) => useEditorRecovery(props), { initialProps: initial });
  await waitFor(() => expect(result.current.copies).toHaveLength(1));
  let discarded!: Promise<void>;
  await act(async () => { discarded = result.current.discard(); });
  rerender({ ...initial, target: "post:8" });
  await waitFor(() => expect(result.current.copies[0]?.id).toBe("other"));
  await act(async () => { finish(); await discarded; });
  expect(result.current.copies[0]?.id).toBe("other");
});

it("does not start storage without an account and target", async () => {
  const start = vi.spyOn(recoveryStorage, "start");
  const view = renderHook(() => useEditorRecovery({ ...initial, userId: undefined, target: null }));
  await act(() => view.result.current.flush());
  expect(start).not.toHaveBeenCalled();
  expect(view.result.current.checking).toBe(false);
});
it("ignores continue during discovery, after navigation and after logout", async () => {
  const view = renderHook((props: RecoveryInput) => useEditorRecovery(props), { initialProps: initial });
  act(() => view.result.current.continueWithoutRestoring());
  expect(view.result.current.checking).toBe(true);
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  const obsoleteContinue = view.result.current.continueWithoutRestoring;
  view.rerender({ ...initial, target: "post:8" });
  act(() => obsoleteContinue());
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  act(() => window.dispatchEvent(new Event("blog:recovery-logout")));
  act(() => view.result.current.continueWithoutRestoring());
  view.rerender({ ...initial, target: "post:8", dirty: true, fields });
  await act(() => view.result.current.flush());
  expect(await recoveryStorage.list(1, "post:8")).toEqual([]);
});

it("adopts its own copy, flushes on hiding, and clears adopted copies after saving", async () => {
  const view = renderHook(() => useEditorRecovery({ ...initial, dirty: true, fields }));
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await view.result.current.flush(); });
  const [copy] = await recoveryStorage.list(1, "post:7");
  expect(copy.fields).toEqual(fields);
  view.unmount();
  const recovered = renderHook(() => useEditorRecovery(initial));
  await waitFor(() => expect(recovered.result.current.copies).toHaveLength(1));
  act(() => recovered.result.current.restore(copy));
  await act(() => recovered.result.current.clear());
  expect(await recoveryStorage.list(1, "post:7")).toEqual([]);
});

it("preserves unsaved text on expiry and rejects writes after another tab logs out", async () => {
  let channel!: { onmessage: ((event: MessageEvent) => void) | null; close: ReturnType<typeof vi.fn> };
  vi.stubGlobal("BroadcastChannel", class {
    onmessage = null;
    close = vi.fn();
    constructor() { channel = this; }
  });
  const view = renderHook((input: RecoveryInput) => useEditorRecovery(input), { initialProps: initial });
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  view.rerender({ ...initial, dirty: true, fields });
  await act(() => preserveExpiredEditor());
  expect((await recoveryStorage.list(1, "post:7"))[0].fields).toEqual(fields);
  act(() => channel.onmessage!(new MessageEvent("message", { data: { userId: 2, action: "logout" } })));
  expect(view.result.current.error).toBe("");
  act(() => channel.onmessage!(new MessageEvent("message", { data: { userId: 1, action: "other" } })));
  expect(view.result.current.error).toBe("");
  act(() => channel.onmessage!(new MessageEvent("message", { data: { userId: 1, action: "logout" } })));
  expect(view.result.current.error).toContain("signed out in another tab");
  view.rerender({ ...initial, dirty: true, fields: { ...fields, content: "Late edit" } });
  await act(() => view.result.current.flush());
  expect((await recoveryStorage.list(1, "post:7"))[0].fields).toEqual(fields);
  view.unmount();
  expect(channel.close).toHaveBeenCalledOnce();
});

it("reports discarded malformed copies but ignores discovery failures after unmount", async () => {
  const original = recoveryStorage.list;
  vi.spyOn(recoveryStorage, "list").mockImplementationOnce((user, target, invalid) => { invalid?.(); return original(user, target); });
  const view = renderHook(() => useEditorRecovery(initial));
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  expect(view.result.current.error).toContain("expired or could not be read");
  view.unmount();
  let reject!: (error: Error) => void;
  vi.spyOn(recoveryStorage, "list").mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const pending = renderHook(() => useEditorRecovery(initial));
  pending.unmount();
  await act(async () => reject(new Error("Late failure")));
});
