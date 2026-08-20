import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "@/lib/markdown";

describe("createMarkdownParser", () => {
  it("renders image dimensions with the shared plugin", () => {
    const html = createMarkdownParser().render("![diagram =320x180](/api/files/1/view)");

    expect(html).toContain('src="/api/files/1/view"');
    expect(html).toContain('alt="diagram"');
    expect(html).toContain('width="320"');
    expect(html).toContain('height="180"');
  });

  it("keeps raw HTML disabled", () => {
    const html = createMarkdownParser().render("<script>alert(1)</script>");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
