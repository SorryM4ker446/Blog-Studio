import MarkdownIt from "markdown-it";
import { imgSize } from "@mdit/plugin-img-size";

export function createMarkdownParser() {
  return new MarkdownIt({ html: false }).use(imgSize);
}
