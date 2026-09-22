"use client";

import { useEffect } from "react";
import { getAdminPost, getApiErrorMessage, type PostDetail } from "@/lib/api";
import { readEditorTarget } from "@/lib/resource-query";
import type MarkdownEditor from "./MarkdownEditor";

interface PostDetailLoaderProps {
  postId: number;
  attempt: number;
  onLoaded: (post: PostDetail, editor: typeof MarkdownEditor) => void;
  onError: (error: string) => void;
}

// Own the request independently of the visible list, so navigation cancels it.
export default function PostDetailLoader({ postId, attempt, onLoaded, onError }: PostDetailLoaderProps) {
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const isCurrent = () => active && window.location.pathname === "/editor"
      && readEditorTarget(new URLSearchParams(window.location.search)) === postId;
    Promise.all([
      getAdminPost(postId, { signal: controller.signal }),
      import("./MarkdownEditor"),
    ]).then(([post, editor]) => {
      if (isCurrent()) onLoaded(post, editor.default);
    }).catch((error) => {
      if (isCurrent()) onError(getApiErrorMessage(error, "Could not load the article."));
    });
    return () => { active = false; controller.abort(); };
  }, [postId, attempt, onLoaded, onError]);
  return null;
}
