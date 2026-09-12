"use client";

import { useEditorRouter as useRouter } from "@/lib/use-editor-router";
import { editorReturnPath } from "@/lib/editor-preview";

interface BackButtonProps {
  text?: string;
  className?: string;
}

export default function BackButton({ text = "← Back", className = "" }: BackButtonProps) {
  const router = useRouter();

  function goBack() {
    const returnTo = editorReturnPath(new URLSearchParams(window.location.search).get("returnTo"), window.location.pathname.split("/").at(-1) ?? "");
    if (returnTo) router.replace(returnTo);
    else if (window.history.length > 1) router.back();
    else router.replace("/posts");
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Back"
      className={className || "back-button"}
    >
      {text}
    </button>
  );
}
