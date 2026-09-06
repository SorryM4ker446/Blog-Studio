package searchtext

import (
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// The browser image-size plugin also accepts shortcut references with dimensions in the label.
// Ordinary inline and explicit reference images are handled by the CommonMark parser.
type sizedReferenceImage struct{}

var sizedLabel = regexp.MustCompile(`^!\[([^\]\n]*?)(?:\s+|^)=([0-9]*%?)x([0-9]*%?)\s*\](?:\[\])?`)

func (sizedReferenceImage) Trigger() []byte { return []byte{'!'} }
func (sizedReferenceImage) Parse(_ ast.Node, reader text.Reader, pc parser.Context) ast.Node {
	line, _ := reader.PeekLine()
	match := sizedLabel.FindSubmatch(line)
	if match == nil || strings.Trim(string(match[2])+string(match[3]), "0%") == "" {
		return nil
	}
	consumed := len(match[0])
	if consumed < len(line) && (line[consumed] == '(' || line[consumed] == '[') {
		return nil
	}
	ref, ok := pc.Reference(util.ToLinkReference([]byte(strings.TrimSpace(string(match[1])))))
	if !ok {
		return nil
	}
	link := ast.NewLink()
	link.Destination = ref.Destination()
	link.Title = ref.Title()
	reader.Advance(consumed)
	return ast.NewImage(link)
}
