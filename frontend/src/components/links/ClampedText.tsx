/** Full text remains available to assistive technology and in the edit form. */
export default function ClampedText({ text, className, paragraph = false, empty = false }: { text: string; className: string; paragraph?: boolean; empty?: boolean }) {
  const Tag = paragraph ? "p" : "span";
  return <Tag className={className} data-empty={empty}>{text}</Tag>;
}
