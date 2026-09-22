import { describe, expect, it } from "vitest";
import { isPostDirty, postSnapshot, validatePostFields, type PostSnapshot } from "./post-editor";

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

describe("article field validation", () => {
  it.each(["", "  ", "\n\t"])("rejects blank titles and content (%j)", blank => {
    const errors = validatePostFields({ title: blank, summary: "", content: blank });
    expect(errors.title).toBe("Please enter a post title.");
    expect(errors.content).toBe("Please enter some post content.");
    expect(errors.summary).toBe("");
  });
  it("accepts the length limits and rejects oversized restored values", () => {
    expect(validatePostFields({ title: "t".repeat(255), summary: "s".repeat(1000), content: "Body" }))
      .toEqual({ title: "", summary: "", content: "" });
    const errors = validatePostFields({ title: "t".repeat(256), summary: "s".repeat(1001), content: "Body" });
    expect(errors.title).not.toBe("");
    expect(errors.summary).not.toBe("");
    expect(errors.content).toBe("");
  });
});
