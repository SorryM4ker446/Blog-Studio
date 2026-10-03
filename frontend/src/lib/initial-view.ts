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
  const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  try {
    const layout = window.history.state?.blogEditorLayout;
    if ((navigation?.type === "reload" || navigation?.type === "back_forward") && window.location.pathname === "/editor"
      && layout?.version === 2 && layout.url === window.location.pathname + window.location.search
      && Number.isSafeInteger(layout.owner) && layout.owner > 0 && layout.width === innerWidth && layout.height === innerHeight
      && [layout.recovery, layout.conflict].every(value => Number.isFinite(value) && value >= 0 && value <= 10_000)
      && Array.isArray(layout.copies) && layout.copies.length <= 3
      && layout.copies.every(copy => copy && typeof copy.title === "string" && copy.title.length <= 255
        && typeof copy.date === "string" && copy.date.length <= 80)) {
      const frame = `html[data-initial-editor-loading] .editor-detail-frame[data-editor-owner="${layout.owner}"][data-recovery-checking="true"]`;
      if (layout.recovery > 0 || layout.conflict > 0) {
        root.setAttribute("data-initial-editor-loading", "true");
        rules += `${frame} [data-editor-notice="recovery"]{min-height:${layout.recovery}px;}`;
        rules += `${frame} [data-editor-notice="conflict"]{min-height:${layout.conflict}px;}`;
        if (layout.copies.length && layout.recovery > 0) {
          const shell = `${frame} [data-recovery-shell][data-loading="true"]`;
          rules += `${shell}{display:grid;}`;
          // CSS-generated text leaves the server DOM intact for hydration.
          const quoted = (value: string) => `"${CSS.escape(value)}"`;
          rules += `${shell} [data-recovery-count]::before{content:${quoted(`${layout.copies.length} ${layout.copies.length === 1 ? "copy" : "copies"}`)};}`;
          layout.copies.forEach((copy, index) => {
            const row = `${shell} [data-recovery-copy="${index}"]`;
            rules += `${row}{display:flex;}`;
            rules += `${row} [data-recovery-title]::before{content:${quoted(copy.title)};}`;
            rules += `${row} [data-recovery-date]::before{content:${quoted(copy.date)};}`;
          });
          const status = `${frame} .editor-save-state > span[data-loading="true"]`;
          rules += `${status}{font-size:0;}${status}::before{font-size:.8125rem;content:"Editing paused · Browser recovery";}`;
        }
      }
    }
  } catch { /* Render the current server layout when history metadata is unavailable. */ }
  style.textContent = rules;
  document.head.appendChild(style);

  if (navigation?.type === "reload") {
    const originalRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let loaded = document.readyState === "complete", hydrated = false;
    const reset = () => {
      document.querySelectorAll("*").forEach(element => { if (element.scrollTop) element.scrollTop = 0; });
    };
    const observer = new MutationObserver(reset);
    const stop = (event?: Event) => {
      if (event) root.setAttribute("data-initial-scroll-cancelled", "true");
      observer.disconnect();
      history.scrollRestoration = originalRestoration;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("load", onLoad);
      window.removeEventListener("blog:initial-view-ready", onReady);
    };
    const onKey = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stop(event); };
    const finish = () => { reset(); if (loaded && hydrated) stop(); };
    const onLoad = () => { loaded = true; finish(); };
    const onReady = () => { hydrated = true; finish(); };
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("load", onLoad);
    window.addEventListener("blog:initial-view-ready", onReady);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("pointerdown", stop, { passive: true });
    window.addEventListener("keydown", onKey);
    reset();
    return;
  }

  if (navigation?.type !== "back_forward") return;
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
