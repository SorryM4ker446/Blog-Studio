"use client";

import { useRouter } from "next/navigation";

export default function BackButton({ text = "← Back" }: { text?: string }) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      style={{
        background: "none",
        border: "none",
        color: "var(--accent-blue)",
        fontSize: "0.9rem",
        fontWeight: 500,
        cursor: "pointer",
        padding: 0,
        transition: "opacity 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      {text}
    </button>
  );
}
