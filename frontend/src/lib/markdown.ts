import MarkdownIt from "markdown-it";
import { imgSize } from "@mdit/plugin-img-size";

export function createMarkdownParser() {
  const parser = new MarkdownIt({ html: false }).use(imgSize);
  const renderImage = parser.renderer.rules.image!;
  parser.renderer.rules.image = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet("loading", "lazy");
    tokens[index].attrSet("decoding", "async");
    return renderImage(tokens, index, options, env, renderer);
  };
  for (const rule of ["fence", "code_block"] as const) {
    const render = parser.renderer.rules[rule]!;
    parser.renderer.rules[rule] = (...args) => render(...args)
      .replace("<pre>", '<pre tabindex="0" role="region" aria-label="Code block">');
  }
  parser.renderer.rules.table_open = (tokens, index, options, _env, renderer) => {
    tokens[index].attrSet("tabindex", "0");
    return renderer.renderToken(tokens, index, options);
  };
  return parser;
}
