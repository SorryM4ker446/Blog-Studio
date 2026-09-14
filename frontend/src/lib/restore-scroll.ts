export function restoreScroll(container: HTMLElement, position: number, done: () => void) {
  let frame = 0;
  let stopped = false;
  const deadline = performance.now() + 2000;
  const keys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    container.removeEventListener("wheel", cancel);
    container.removeEventListener("touchstart", cancel);
    container.removeEventListener("pointerdown", cancel);
    window.removeEventListener("keydown", onKey);
    done();
  };
  const onKey = (event: KeyboardEvent) => { if (keys.has(event.key)) cancel(); };
  const restore = () => {
    if (stopped) return;
    container.scrollTop = Math.max(0, position);
    if (Math.abs(container.scrollTop - position) <= 1 || performance.now() >= deadline) cancel();
    else frame = requestAnimationFrame(restore);
  };
  container.addEventListener("wheel", cancel, { passive: true });
  container.addEventListener("touchstart", cancel, { passive: true });
  container.addEventListener("pointerdown", cancel, { passive: true });
  window.addEventListener("keydown", onKey);
  restore();
  return cancel;
}
