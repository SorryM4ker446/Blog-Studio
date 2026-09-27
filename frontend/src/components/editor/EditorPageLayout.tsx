import type { CSSProperties, ReactNode } from "react";
import styles from "./EditorPageLayout.module.css";

export default function EditorPageLayout({ children, count, pages, resource }: {
  children: ReactNode; count: number; pages: number; resource: "posts" | "files" | "links";
}) {
  const pageSize = resource === "links" ? 8 : 10;
  const slots = pages > 1 ? pageSize : Math.min(pageSize, Math.max(1, count));
  const style = { "--rows-1": slots } as CSSProperties;
  return <div className={styles.layout} data-editor-layout={resource} style={style}>{children}</div>;
}
