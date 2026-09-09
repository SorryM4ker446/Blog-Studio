import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostDetail } from "./api";
import { clearEditorPreview, editorReturnPath, readEditorPreview, rememberEditorPreview } from "./editor-preview";

const post = { id: 7, version: 2, content: "Saved" } as PostDetail;
const fields = { title: "Local title", summary: "Local introduction", content: "Unsaved", category_id: 3 };
afterEach(() => { clearEditorPreview(); vi.useRealTimers(); });

describe("Editor article viewing", () => {
  it("retains unsaved fields and the original version only for the matching user and article", () => {
    rememberEditorPreview(1, "/editor?edit=7&q=filter", post, fields);
    expect(readEditorPreview(1, 7)).toMatchObject({ post, fields, returnTo: "/editor?edit=7&q=filter" });
    expect(readEditorPreview(2, 7)).toBeNull();
    expect(readEditorPreview(undefined, 7)).toBeNull();
    expect(readEditorPreview(1, 8)).toBeNull();
  });
  it("expires the handoff and clears it on logout or consumption", () => {
    vi.useFakeTimers();
    rememberEditorPreview(1, "/editor?edit=7", post, fields);
    vi.advanceTimersByTime(30 * 60_000);
    expect(readEditorPreview(1, 7)).toBeNull();
    rememberEditorPreview(1, "/editor?edit=7", post, fields);
    clearEditorPreview();
    expect(readEditorPreview(1, 7)).toBeNull();
  });
  it("accepts only a local editor target matching the viewed article", () => {
    expect(editorReturnPath("/editor?tab=posts&edit=7&q=filter", "7")).toBe("/editor?tab=posts&edit=7&q=filter");
    for (const value of [null, "https://example.com", "//example.com/editor?edit=7", "javascript:alert(1)", "/editor?edit=8", "/editor?edit=7&edit=8", "/editor?edit=7&tab=files", "/editor?edit=7#other"]) {
      expect(editorReturnPath(value, "7")).toBeNull();
    }
  });
});
