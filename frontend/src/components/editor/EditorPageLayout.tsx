import type { CSSProperties, ReactNode } from "react";
import styles from "./EditorPageLayout.module.css";

export default function EditorPageLayout({ children, count, pages, resource }: {
  children: ReactNode; count: number; pages: number; resource: "posts" | "files" | "links";
}) {
  const pageSize = resource === "links" ? 8 : 10;
  const slots = pages > 1 ? pageSize : Math.min(pageSize, Math.max(1, count));
  const style = Object.fromEntries([1, 2, 3, 4, 5].map(columns => [`--rows-${columns}`, Math.ceil(slots / columns)])) as CSSProperties;
  return <div className={styles.layout} data-editor-layout={resource} style={style}>{children}</div>;
}
