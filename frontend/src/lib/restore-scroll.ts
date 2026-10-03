export function restoreScroll(container: HTMLElement, position: number, done: () => void) {
  let frame = 0;
  let stopped = false;
  let deadline = performance.now() + 2000;
  const pending = () => Boolean(container.querySelector('[data-scroll-pending="true"]'));
  const observer = new MutationObserver(() => {
    if (!pending() && !stopped) {
      observer.disconnect();
      deadline = performance.now() + 2000;
      restore();
    }
  });
  const keys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
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
    // Recovery discovery can outlive the ordinary layout retry window.
    // Wait for its owned lifecycle instead of completing against a short form.
    if (pending()) {
      observer.observe(container, { attributes: true, childList: true, subtree: true, attributeFilter: ["data-scroll-pending"] });
      return;
    }
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

export function resetPageScroll() {
  document.querySelectorAll("*").forEach(element => { if (element.scrollTop) element.scrollTop = 0; });
}

export function scrollPageToTop(done: () => void, interrupted: () => void) {
  const positions = Array.from(document.querySelectorAll("*")).filter(element => element.scrollTop > 0)
    .map(element => ({ element, top: element.scrollTop }));
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const started = performance.now();
  let frame = 0, active = true;
  const cleanup = () => {
    active = false;
    cancelAnimationFrame(frame);
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("pointerdown", cancel);
    window.removeEventListener("keydown", onKey);
  };
  const cancel = () => { if (!active) return; cleanup(); interrupted(); };
  const onKey = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancel(); };
  const animate = (now: number) => {
    if (!active) return;
    const progress = reduced || !positions.length ? 1 : Math.min(1, (now - started) / 320);
    positions.forEach(({ element, top }) => { element.scrollTop = top * (1 - progress) ** 3; });
    if (progress < 1) frame = requestAnimationFrame(animate);
    else { resetPageScroll(); cleanup(); done(); }
  };
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchstart", cancel, { passive: true });
  window.addEventListener("pointerdown", cancel, { passive: true });
  window.addEventListener("keydown", onKey);
  frame = requestAnimationFrame(animate);
  return cancel;
}
