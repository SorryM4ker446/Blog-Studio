package searchtext

import "testing"

func TestExtractVisibleMarkdown(t *testing.T) {
	for _, test := range []struct{ name, input, want string }{
		{"empty", "", ""},
		{"formatted prose", "# Heading\n\nSome **bold** and *italic* 中文。", "Heading\nSome bold and italic 中文。"},
		{"links and images", "Read [the **guide**](https://example.test/hidden) ![secret](image.png \"hidden title\")", "Read the guide"},
		{"references", "[Visible][doc] ![secret][pic]\n\n[doc]: https://example.test/target\n[pic]: image.png", "Visible"},
		{"nested image", "[![private](image.png)](https://example.test/hidden)", ""},
		{"entities", "Fish &amp; chips &#x4E2D; &#25991; \\*literal\\*", "Fish & chips 中 文 *literal*"},
		{"code span", "A `&amp; **code**` example", "A &amp; **code** example"},
		{"fenced code", "```go\nfmt.Println(\"中文\")\n```", "fmt.Println(\"中文\")"},
		{"indented code", "    &amp; literal\n", "&amp; literal"},
		{"URLs", "before https://example.test/private after <https://example.test/secret>", "before   after"},
		{"HTML literal", "<div>**Visible** &amp; text</div>", "<div>Visible & text</div>"},
		{"newlines", "first\r\nsecond\n\nthird", "first\nsecond\nthird"},
		{"short unicode", "中 e\u0301 Äpfel Σίσυφος", "中 e\u0301 Äpfel Σίσυφος"},
		{"email", "<hello@example.test>", "hello@example.test"},
		{"single entity decoding", `\&amp; &amp;amp; &#38;amp;`, "&amp; &amp; &amp;"},
		{"table boundaries", "|one|two|\n|---|---|\n|cell|value|", "one\ntwo\n\ncell\nvalue"},
		{"strikethrough", "~~old~~ and ~~two words~~", "old and two words"},
		{"literal single tilde", "~literal~ and ~~deleted~~", "~literal~ and deleted"},
		{"inline image size", "![hidden =100x200](image.png)", ""},
		{"sized shortcut image", "![hidden =100x200]\n\n[hidden]: image.png", ""},
		{"sized collapsed image", "![hidden =50%x][]\n\n[hidden]: image.png", ""},
		{"sized explicit image", "![hidden =100x200][ref]\n\n[ref]: image.png", ""},
		{"missing sized reference", "![visible =100x200]", "![visible =100x200]"},
		{"invalid zero size", "![visible =0x0]\n\n[visible]: image.png", "![visible =0x0]"},
		{"multiline code span", "`a\nb`", "a b"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := Extract(test.input); got != test.want {
				t.Fatalf("Extract() = %q, want %q", got, test.want)
			}
		})
	}
}
