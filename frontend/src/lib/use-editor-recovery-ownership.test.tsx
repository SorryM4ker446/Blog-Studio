import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { recoveryStorage } from "./editor-recovery-store";
import { useEditorRecovery } from "./use-editor-recovery";

afterEach(() => vi.unstubAllGlobals());
it("forks a colliding document owner even when writing the tab key is denied", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
  const owners: string[] = [];
  const request = vi.fn((name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
    owners.push(name);
    return callback(owners.length === 1 ? null : {});
  });
  vi.stubGlobal("navigator", { locks: { request } });
  const fields = { title: "Draft", summary: "", content: "Unsaved text", category_id: 0 };
  const view = renderHook(() => useEditorRecovery({ userId: 1, target: "new:copy", ready: true, dirty: true, busy: false, version: null, baseline: { ...fields, content: "" }, fields, onRestore: vi.fn() }));
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  await act(() => view.result.current.flush());
  expect(owners).toHaveLength(2);
  expect(owners[0]).not.toBe(owners[1]);
  const [copy] = await recoveryStorage.list(1, "new:copy");
  expect(owners[1]).toBe(`blogStudio:recoveryTab:${copy.tab}`);
  expect(copy.fields).toEqual(fields);
});
