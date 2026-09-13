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
  try {
    const cache = JSON.parse(window.sessionStorage.getItem("blogStudio:listLayouts") || "null");
    if (cache?.version === 1 && Array.isArray(cache.entries)) {
      for (const entry of cache.entries.slice(-20)) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].length > 2048) continue;
        const size = entry[1];
        if (!size || !Number.isFinite(size.width) || size.width <= 0 || size.width > 20_000
          || !Number.isFinite(size.height) || size.height <= 0 || size.height > 100_000) continue;
        rules += `@container list-results (min-width:${size.width - 1}px) and (max-width:${size.width + 1}px){[data-list-layout="${CSS.escape(entry[0])}"]{min-height:${size.height}px;}}`;
      }
    }
  } catch { /* Layout still works without storage. */ }
  style.textContent = rules;
  document.head.appendChild(style);

  const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type !== "reload" && navigation?.type !== "back_forward") return;
  let position = 0;
  try {
    const query = new URLSearchParams(window.location.search).toString();
    const location = window.location.pathname + (query ? `?${query}` : "");
    position = Number(window.sessionStorage.getItem(`blogStudio:contentScroll:${encodeURIComponent(location)}`));
  } catch { return; }
  if (!Number.isFinite(position) || position <= 0) return;
  let complete = false;
  const restore = () => {
    if (complete) return;
    const scroll = document.querySelector<HTMLElement>(".content-scroll");
    if (!scroll) return;
    scroll.scrollTop = position;
    if (Math.abs(scroll.scrollTop - position) <= 1) { complete = true; observer.disconnect(); }
  };
  const observer = new MutationObserver(restore);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  restore();
  window.addEventListener("load", () => { restore(); observer.disconnect(); }, { once: true });
}

export const initialViewScript = `(${restoreInitialView.toString()})();`;
