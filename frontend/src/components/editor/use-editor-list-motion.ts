"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { FileRecord, PostSummary } from "@/lib/api";
import type { EditorTarget } from "@/lib/resource-query";
import type { EditorTab } from "./EditorListView";
import { animateCreatedListRow, animateDeletedListRow, type DeletedListSnapshot, type ListRowsSnapshot } from "./list-row-motion";

export function useEditorListMotion({ urlTab, editTarget, postData, fileData, postPage, filePage,
  postsError, filesError, uploadDialogOpen,
}: { urlTab: EditorTab; editTarget: EditorTarget; postData: PostSummary[]; fileData: FileRecord[];
  postPage: number; filePage: number; postsError: string; filesError: string; uploadDialogOpen: boolean;
}) {
  const pendingListDeletion = useRef<{ type: "post" | "file"; snapshot: DeletedListSnapshot; data: PostSummary[] | FileRecord[] } | null>(null);
  const listDeletionMotion = useRef<(() => void) | null>(null);
  const pendingCreatedPostId = useRef<number | null>(null);
  const postListBeforeCreate = useRef<ListRowsSnapshot | null>(null);
  const pendingCreatedFile = useRef<{ id: number; snapshot: ListRowsSnapshot | null; data: FileRecord[] } | null>(null);
  const listCreationMotion = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (urlTab !== "posts" || editTarget !== null || pendingCreatedPostId.current === null) return;
    const id = pendingCreatedPostId.current;
    pendingCreatedPostId.current = null;
    listCreationMotion.current?.();
    listCreationMotion.current = animateCreatedListRow(
      document.querySelector<HTMLElement>('[data-editor-list][data-resource="posts"]'), id, postPage, postListBeforeCreate.current, "fade");
    postListBeforeCreate.current = null;
  }, [urlTab, editTarget, postData, postPage]);
  useLayoutEffect(() => {
    const pending = pendingListDeletion.current;
    if (!pending) return;
    const data = pending.type === "post" ? postData : fileData;
    const error = pending.type === "post" ? postsError : filesError;
    if (data === pending.data && !error) return;
    pendingListDeletion.current = null;
    listDeletionMotion.current?.();
    if (!error && !data.some((item) => String(item.id) === pending.snapshot.deletedId)) {
      listDeletionMotion.current = animateDeletedListRow(pending.snapshot, pending.type === "post" ? postPage : filePage);
    }
  }, [postData, fileData, postPage, filePage, postsError, filesError]);
  useEffect(() => () => { listDeletionMotion.current?.(); listCreationMotion.current?.(); }, []);
  useEffect(() => { listDeletionMotion.current?.(); listDeletionMotion.current = null; pendingListDeletion.current = null; }, [urlTab, editTarget]);
  useEffect(() => { if (urlTab !== "posts") pendingCreatedPostId.current = null; }, [urlTab]);
  useLayoutEffect(() => {
    if (uploadDialogOpen || !pendingCreatedFile.current) return;
    const pending = pendingCreatedFile.current;
    if (pending.data === fileData && !filesError) return;
    pendingCreatedFile.current = null;
    listCreationMotion.current?.();
    if (!filesError) listCreationMotion.current = animateCreatedListRow(
      document.querySelector<HTMLElement>('[data-editor-list][data-resource="files"]'), pending.id, filePage, pending.snapshot);
  }, [uploadDialogOpen, fileData, filePage, filesError]);

  return { pendingListDeletion, pendingCreatedPostId, postListBeforeCreate, pendingCreatedFile };
}
