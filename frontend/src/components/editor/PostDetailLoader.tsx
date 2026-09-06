"use client";

import { useEffect, useState } from "react";
import { getAdminPost, getApiErrorMessage, type PostDetail } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";

interface PostDetailLoaderProps {
  postId: number;
  onLoaded: (post: PostDetail) => void;
  onBack: () => void;
}

export default function PostDetailLoader({ postId, onLoaded, onBack }: PostDetailLoaderProps) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getAdminPost(postId, { signal: controller.signal })
      .then((post) => { if (active) onLoaded(post); })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, "Could not load the article."));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [postId, attempt, onLoaded]);

  return (
    <section>
      <button type="button" className="editor-back-button" onClick={onBack} aria-label="Back to content list">←</button>
      {error ? (
        <ErrorState
          title="Article could not be loaded"
          message={error}
          onRetry={() => { setError(""); setAttempt((current) => current + 1); }}
        />
      ) : <LoadingState label="Loading article…" rows={3} />}
    </section>
  );
}
