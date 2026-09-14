// Keep this function self-contained: the server embeds it before the streamed UI.
function restoreInitialView() {
  const root = document.documentElement;
  const style = document.createElement("style");
  style.id = "blog-initial-view";
  let rules = "";
  try {
    const source = window.history.state?.blogSidebarSelection;
    if (window.location.pathname.startsWith("/posts/") && typeof source === "string"
      && /^\/(?:posts(?:\?category=\d+)?|editor|search|drive|login|settings)?$/.test(source)) {
      root.setAttribute("data-initial-sidebar", source);
      const base = 'html[data-initial-sidebar] [data-sidebar-section]';
      rules += `${base}{background:transparent;color:var(--text-secondary);box-shadow:none;transition:none;}`;
      rules += `${base} .sidebar-category-count{box-shadow:none;}`;
      if (source !== "/") {
        const selected = `${base}[data-sidebar-section="${CSS.escape(source)}"]`;
        rules += `${selected}{background:var(--nav-active);color:var(--text-primary);}`;
        if (source.startsWith("/posts?")) {
          rules += `${selected}{background:color-mix(in srgb,var(--accent-blue) 16%,var(--bg-surface));box-shadow:inset 3px 0 0 var(--accent-blue);font-weight:600;}`;
          rules += `${selected} .sidebar-category-count{box-shadow:0 0 0 2px color-mix(in srgb,var(--accent-blue) 28%,transparent);}`;
        }
      }
    }
  } catch { /* Use the server-rendered selection when history is unavailable. */ }
  try { window.sessionStorage.removeItem("blogStudio:listLayouts"); } catch { /* Obsolete storage may be blocked. */ }
  style.textContent = rules;
  document.head.appendChild(style);

  const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type !== "reload" && navigation?.type !== "back_forward") return;
  const entry = window.history.state?.blogNavigation;
  const position = entry?.version === 1 && entry.url === window.location.pathname + window.location.search ? entry.scroll : 0;
  if (!Number.isFinite(position) || position <= 0 || position > 10_000_000) return;
  let complete = false;
  const stop = (event?: Event) => {
    if (event) root.setAttribute("data-initial-scroll-cancelled", "true");
    complete = true;
    observer.disconnect();
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("pointerdown", stop);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("blog:initial-view-ready", release);
  };
  const onKey = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stop(event); };
  const release = () => stop();
  const restore = () => {
    if (complete) return;
    const scroll = document.querySelector<HTMLElement>(".content-scroll");
    if (!scroll) return;
    scroll.scrollTop = position;
    if (Math.abs(scroll.scrollTop - position) <= 1) { complete = true; observer.disconnect(); }
  };
  const observer = new MutationObserver(restore);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("pointerdown", stop, { passive: true });
  window.addEventListener("keydown", onKey);
  window.addEventListener("blog:initial-view-ready", release, { once: true });
  restore();
  window.addEventListener("load", () => { restore(); observer.disconnect(); }, { once: true });
}

export const initialViewScript = `(${restoreInitialView.toString()})();`;
