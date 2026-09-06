// Package searchtext derives searchable body text from the supported Markdown syntax.
package searchtext

import (
	"bytes"
	"html"
	"regexp"
	"slices"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var bareURL = regexp.MustCompile(`(?i)https?://[^\s<>]+`)
var textEscape = regexp.MustCompile("\\\\[!\"#$%&'()*+,\\-./:;<=>?@\\[\\]\\\\^_`{|}~]|&(?:[A-Za-z][A-Za-z0-9]+|#[0-9]{1,7}|#[xX][A-Fa-f0-9]{1,6});")
var markdown = newParser()

func newParser() goldmark.Markdown {
	blocks := slices.DeleteFunc(parser.DefaultBlockParsers(), func(p util.PrioritizedValue) bool { return p.Value == parser.NewHTMLBlockParser() })
	inlines := slices.DeleteFunc(parser.DefaultInlineParsers(), func(p util.PrioritizedValue) bool { return p.Value == parser.NewRawHTMLParser() })
	// HTML stays literal, matching the browser renderer's html:false setting.
	return goldmark.New(goldmark.WithParser(parser.NewParser(
		parser.WithBlockParsers(blocks...), parser.WithInlineParsers(inlines...),
		parser.WithInlineParsers(util.Prioritized(sizedReferenceImage{}, 100)),
		parser.WithInlineParsers(util.Prioritized(doubleStrikethrough{extension.NewStrikethroughParser()}, 500)),
		parser.WithParagraphTransformers(parser.DefaultParagraphTransformers()...),
	)), goldmark.WithExtensions(extension.Table))
}

type doubleStrikethrough struct{ parser.InlineParser }

func (p doubleStrikethrough) Parse(parent ast.Node, reader text.Reader, pc parser.Context) ast.Node {
	line, _ := reader.PeekLine()
	if !bytes.HasPrefix(line, []byte("~~")) {
		return nil
	}
	return p.InlineParser.Parse(parent, reader, pc)
}

// Extract is shared by historical backfill and explicit article write paths.
// It preserves field boundaries and does not fold case or concatenate metadata.
func Extract(content string) string {
	source := []byte(strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", "\n"), "\r", "\n"))
	doc := markdown.Parser().Parse(text.NewReader(source))
	var out strings.Builder
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			if n.Type() == ast.TypeBlock {
				out.WriteByte('\n')
			}
			return ast.WalkContinue, nil
		}
		switch node := n.(type) {
		case *ast.Image:
			out.WriteByte(' ')
			return ast.WalkSkipChildren, nil
		case *ast.AutoLink:
			if node.AutoLinkType == ast.AutoLinkEmail {
				out.Write(node.Label(source))
			} else {
				out.WriteByte(' ')
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeSpan:
			for child := node.FirstChild(); child != nil; child = child.NextSibling() {
				segment := child.(*ast.Text).Segment
				out.Write(bytes.ReplaceAll(segment.Value(source), []byte("\n"), []byte(" ")))
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeBlock, *ast.FencedCodeBlock:
			for i := 0; i < n.Lines().Len(); i++ {
				segment := n.Lines().At(i)
				out.Write(segment.Value(source))
			}
			out.WriteByte('\n')
			return ast.WalkSkipChildren, nil
		case *ast.Text:
			value := node.Segment.Value(source)
			value = textEscape.ReplaceAllFunc(value, func(token []byte) []byte {
				if token[0] == '\\' {
					return token[1:]
				}
				return []byte(html.UnescapeString(string(token)))
			})
			out.Write(value)
			if node.SoftLineBreak() || node.HardLineBreak() {
				out.WriteByte('\n')
			}
		case *ast.String:
			out.Write(node.Value)
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(bareURL.ReplaceAllString(out.String(), " "))
}
