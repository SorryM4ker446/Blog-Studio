"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/AsyncState";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="fade-in" style={{ maxWidth: "720px", margin: "4rem auto", padding: "0 1rem" }}>
      <ErrorState
        title="Something went wrong"
        message="This page could not be displayed. Try again, or return later if the problem continues."
        onRetry={reset}
      />
    </main>
  );
}
