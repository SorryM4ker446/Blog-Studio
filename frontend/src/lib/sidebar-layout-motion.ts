// Only component positions are animated. Article bodies and editor fields keep
// their normal layout, dimensions and DOM identity throughout the transition.
const targets = [
  ".route-transition-frame > div:not(.post-frame) > *",
  ".card-grid > *",
  ".editor-resource-grid > *",
  ".search-filters > *",
].join(",");
const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
type Point = { x: number; y: number };
type Sample = { layout: Point; visual: Point };

export function createSidebarLayoutMotion(container: HTMLElement) {
  const animations = new Map<HTMLElement, Animation>();
  let previous = new Map<HTMLElement, Sample>();
  let frame = 0;
  let deadline = 0;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");

  function offsets() {
    return new Map([...animations.keys()].map(element => {
      const values = getComputedStyle(element).translate.split(" ").map(Number.parseFloat);
      return [element, { x: values[0] || 0, y: values[1] || 0 }];
    }));
  }
  function inherited(element: HTMLElement, translations: Map<HTMLElement, Point>) {
    const point = { x: 0, y: 0 };
    for (let parent = element.parentElement; parent && parent !== container; parent = parent.parentElement) {
      const offset = translations.get(parent);
      if (offset) { point.x += offset.x; point.y += offset.y; }
    }
    return point;
  }
  function measure(translations: Map<HTMLElement, Point>) {
    const origin = container.getBoundingClientRect();
    const samples = new Map<HTMLElement, Sample>();
    container.querySelectorAll<HTMLElement>(targets).forEach(element => {
      if (element.closest(".post-frame, .editor-detail-frame, .rc-md-editor, [role='dialog']") || !element.getClientRects().length) return;
      const rect = element.getBoundingClientRect();
      // Read only visible components; a long article/list must not add work to
      // every frame. Include a margin for cards moving between adjacent rows.
      if (rect.bottom < origin.top - 200 || rect.top > origin.bottom + 200) return;
      const parent = inherited(element, translations);
      const own = translations.get(element) || { x: 0, y: 0 };
      const visual = { x: rect.x - origin.x + container.scrollLeft, y: rect.y - origin.y + container.scrollTop };
      samples.set(element, { visual, layout: { x: visual.x - parent.x - own.x, y: visual.y - parent.y - own.y } });
    });
    return samples;
  }
  function tick() {
    if (preference.matches || !container.isConnected) { stop(); return; }
    const translations = offsets();
    // Batch geometry reads before starting animations to avoid read/write
    // layout thrashing. CSS handles continuous horizontal sidebar movement.
    const next = measure(translations);
    for (const [element, current] of next) {
      const before = previous.get(element);
      if (!before) continue;
      const dx = before.layout.x - current.layout.x;
      const dy = before.layout.y - current.layout.y;
      // Responsive grid columns and wrapped controls move discontinuously;
      // ordinary subpixel width changes already follow the sidebar's easing.
      if (Math.abs(dx) < 24 && Math.abs(dy) < 8) continue;
      const parent = inherited(element, translations);
      const from = { x: before.visual.x - current.layout.x - parent.x, y: before.visual.y - current.layout.y - parent.y };
      animations.get(element)?.cancel();
      const animation = element.animate([
        { translate: `${from.x}px ${from.y}px` },
        { translate: "0px 0px" },
      ], { duration: 320, easing });
      animations.set(element, animation);
      translations.set(element, from);
      current.visual = before.visual;
      animation.onfinish = () => { if (animations.get(element) === animation) animations.delete(element); };
    }
    previous = next;
    if (performance.now() < deadline || animations.size) frame = requestAnimationFrame(tick);
    else frame = 0;
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    animations.forEach(animation => animation.cancel());
    animations.clear();
    previous.clear();
  }
  preference.addEventListener("change", stop);
  return {
    start() {
      if (preference.matches || typeof Element.prototype.animate !== "function") return;
      previous = measure(offsets());
      deadline = performance.now() + 520;
      if (!frame) frame = requestAnimationFrame(tick);
    },
    dispose() { stop(); preference.removeEventListener("change", stop); },
  };
}
