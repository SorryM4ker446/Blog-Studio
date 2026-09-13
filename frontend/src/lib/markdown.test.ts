import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "@/lib/markdown";

describe("createMarkdownParser", () => {
  it("renders image dimensions with the shared plugin", () => {
    const html = createMarkdownParser().render("![diagram =320x180](/api/files/1/view)");

    expect(html).toContain('src="/api/files/1/view"');
    expect(html).toContain('alt="diagram"');
    expect(html).toContain('width="320"');
    expect(html).toContain('height="180"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("keeps raw HTML disabled", () => {
    const html = createMarkdownParser().render("<script>alert(1)</script>");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("makes local code and table scrolling keyboard accessible without enabling unsafe links", () => {
    const parser = createMarkdownParser();
    expect(parser.render("```\nlong code\n```\n\n    indented code")).toContain('tabindex="0" role="region" aria-label="Code block"');
    expect(parser.render("| A | B |\n| - | - |\n| 1 | 2 |")).toContain('<table tabindex="0">');
    const unsafe = parser.render("[unsafe](javascript:alert(1)) ![unsafe](javascript:alert(1))");
    expect(unsafe).not.toContain('href="javascript:');
    expect(unsafe).not.toContain('src="javascript:');
  });
});
