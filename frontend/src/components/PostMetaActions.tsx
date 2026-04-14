"use client";

import { useState } from "react";

export default function PostMetaActions() {
  const [copied, setCopied] = useState(false);

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="post-copy-link" onClick={handleCopyUrl}>
      <span aria-hidden="true" className="post-copy-icon">
        #
      </span>
      <span>{copied ? "Copied URL" : "Copy URL"}</span>
    </button>
  );
}
