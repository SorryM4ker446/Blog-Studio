import { describe, expect, it } from "vitest";
import { editorReturnPath } from "./editor-preview";

describe("Editor article return paths", () => {
  it("accepts only a local editor target matching the viewed article", () => {
    expect(editorReturnPath("/editor?tab=posts&edit=7&q=filter", "7")).toBe("/editor?tab=posts&edit=7&q=filter");
    for (const value of [null, "https://example.com", "//example.com/editor?edit=7", "javascript:alert(1)", "/editor?edit=8", "/editor?edit=7&edit=8", "/editor?edit=7&tab=files", "/editor?edit=7#other"]) {
      expect(editorReturnPath(value, "7")).toBeNull();
    }
  });
});
