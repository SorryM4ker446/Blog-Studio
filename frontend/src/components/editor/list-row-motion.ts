export interface ListRowsSnapshot {
  container: HTMLElement;
  page: number;
  positions: Map<string, number>;
}

export interface DeletedListSnapshot extends ListRowsSnapshot {
  deletedId: string;
  ghost: HTMLElement;
  rect: DOMRect;
}

const rowSelector = "[data-editor-row-id]";

export function captureListRows(container: HTMLElement | null, page: number): ListRowsSnapshot | null {
  if (!container) return null;
  const rows = Array.from(container.querySelectorAll<HTMLElement>(rowSelector));
  const listTop = container.getBoundingClientRect().top;
  return {
    container,
    page,
    positions: new Map(rows.map((item) => [item.dataset.editorRowId!, item.getBoundingClientRect().top - listTop])),
  };
}

export function captureDeletedListRow(container: HTMLElement | null, deletedId: number, page: number): DeletedListSnapshot | null {
  const snapshot = captureListRows(container, page);
  const row = Array.from(container?.querySelectorAll<HTMLElement>(rowSelector) || [])
    .find((item) => item.dataset.editorRowId === String(deletedId));
  if (!snapshot || !row) return null;
  return {
    ...snapshot,
    deletedId: String(deletedId),
    ghost: row.cloneNode(true) as HTMLElement,
    rect: row.getBoundingClientRect(),
  };
}

export function animateCreatedListRow(container: HTMLElement | null, createdId: number, page: number, previous: ListRowsSnapshot | null,
  entrance: "rise" | "fade" = "rise"): () => void {
  if (!container || previous?.positions.has(String(createdId))
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  const stablePrevious = previous?.page === page
    && (previous.container === container || !previous.container.isConnected) ? previous : null;
  const rows = Array.from(container.querySelectorAll<HTMLElement>(rowSelector));
  const created = rows.find((row) => row.dataset.editorRowId === String(createdId));
  if (!created || typeof created.animate !== "function") return () => {};
  const clearEntrance = (event: AnimationEvent) => {
    if (event.target !== created || event.pseudoElement !== "::before") return;
    created.removeAttribute("data-editor-entering");
    created.removeEventListener("animationend", clearEntrance);
    created.removeEventListener("animationcancel", clearEntrance);
  };
  created.addEventListener("animationend", clearEntrance);
  created.addEventListener("animationcancel", clearEntrance);
  created.setAttribute("data-editor-entering", "");
  const listTop = container.getBoundingClientRect().top;
  const positions = rows.map((row) => ({ row, previousTop: stablePrevious?.positions.get(row.dataset.editorRowId!),
    currentTop: row.getBoundingClientRect().top - listTop }));
  const animations: Animation[] = [];
  for (const { row, previousTop, currentTop } of positions) {
    if (row === created) {
      animations.push(row.animate(entrance === "fade"
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 180, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" }));
    } else if (previousTop !== undefined && Math.abs(previousTop - currentTop) > 1) {
      animations.push(row.animate([
        { transform: `translateY(${previousTop - currentTop}px)` },
        { transform: "translateY(0)" },
      ], { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" }));
    }
  }
  return () => {
    animations.forEach((animation) => animation.cancel());
    created.removeAttribute("data-editor-entering");
    created.removeEventListener("animationend", clearEntrance);
    created.removeEventListener("animationcancel", clearEntrance);
  };
}

export function animateDeletedListRow(snapshot: DeletedListSnapshot, page: number): () => void {
  const { container, ghost, rect } = snapshot;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof ghost.animate !== "function") return () => {};
  const rows = container.isConnected && page === snapshot.page
    ? Array.from(container.querySelectorAll<HTMLElement>(rowSelector)) : [];
  if (rows.some((row) => row.dataset.editorRowId === snapshot.deletedId)) return () => {};
  const listTop = container.isConnected ? container.getBoundingClientRect().top : 0;
  const movements = rows.map((row) => ({
    row,
    previousTop: snapshot.positions.get(row.dataset.editorRowId!),
    currentTop: row.getBoundingClientRect().top - listTop,
  }));
  const animations: Animation[] = [];
  for (const { row, previousTop, currentTop } of movements) {
    if (previousTop === undefined) {
      animations.push(row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out", fill: "backwards" }));
    } else if (Math.abs(previousTop - currentTop) > 1) {
      animations.push(row.animate([
        { transform: `translateY(${previousTop - currentTop}px)` },
        { transform: "translateY(0)" },
      ], { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" }));
    }
  }
  ghost.dataset.editorDeletionGhost = "";
  const shell = document.createElement("div");
  shell.setAttribute("aria-hidden", "true");
  shell.inert = true;
  Object.assign(shell.style, {
    position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    zIndex: "1", pointerEvents: "none", containerType: "inline-size", containerName: "editor-page",
  });
  shell.style.setProperty("--list-row-height", `${rect.height}px`);
  Object.assign(ghost.style, { width: "100%", height: "100%", margin: "0", pointerEvents: "none", transition: "none" });
  shell.append(ghost);
  document.body.append(shell);
  const exit = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-out", fill: "forwards" });
  exit.onfinish = () => shell.remove();
  animations.push(exit);
  return () => { animations.forEach((animation) => animation.cancel()); shell.remove(); };
}
