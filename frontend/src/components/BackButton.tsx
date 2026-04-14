"use client";

import { useRouter } from "next/navigation";

interface BackButtonProps {
  text?: string;
  className?: string;
}

export default function BackButton({ text = "← Back", className = "" }: BackButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={className || "back-button"}
    >
      {text}
    </button>
  );
}
