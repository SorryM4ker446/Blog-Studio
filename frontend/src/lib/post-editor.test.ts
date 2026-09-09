import { describe, expect, it } from "vitest";
import { isPostDirty, postSnapshot, type PostSnapshot } from "./post-editor";

describe("saved article snapshots", () => {
  const saved = { title: "Title", summary: "Summary", content: "Body", category_id: 1 };
  it.each(["title", "summary", "content", "category_id"] as const)("tracks and clears changes to %s", field => {
    const changed: PostSnapshot = { ...saved, [field]: field === "category_id" ? 2 : "Changed" };
    expect(isPostDirty(changed, saved)).toBe(true);
    expect(isPostDirty({ ...changed, [field]: saved[field] }, saved)).toBe(false);
  });
  it("starts an empty new draft clean and detects entered text", () => {
    const empty = postSnapshot(null);
    expect(isPostDirty(empty, empty)).toBe(false);
    expect(isPostDirty({ ...empty, content: "New body" }, empty)).toBe(true);
  });
});
