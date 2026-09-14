"use client";

import { useState, type ReactNode } from "react";

export default function EditorViewTransition({ detail, children }: { detail: boolean; children: ReactNode }) {
  const [view, setView] = useState({ detail, entering: false });
  if (view.detail !== detail) setView({ detail, entering: true });
  return <div className={view.entering ? "fade-in" : undefined} data-editor-view={detail ? "detail" : "list"}
    onAnimationEnd={event => {
      if (event.target === event.currentTarget) setView(current => ({ ...current, entering: false }));
    }}>{children}</div>;
}
