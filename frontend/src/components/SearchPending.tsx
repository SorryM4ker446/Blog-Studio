"use client";

import { useEffect, useState } from "react";
import styles from "./SearchPageClient.module.css";

export default function SearchPending() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(timer);
  }, []);

  return <div role="status" className={styles.pending}>
    <span className={visible ? styles.pendingLabel : "sr-only"}>Searching posts and files…</span>
  </div>;
}
