"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { isCustomLinkColor, linkColors, type LinkColor } from "@/lib/links";
import styles from "./Links.module.css";

const presetHex = { blue: "#a8c7fa", yellow: "#fbd284", green: "#6dd68c", red: "#f28b82" } as const;
type HSV = { h: number; s: number; v: number };
function fromHex(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const h = delta ? ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360 : 0;
  return { h, s: max ? delta / max * 100 : 0, v: max * 100 };
}
function toHex({ h, s, v }: HSV): `#${string}` {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * v / 100 * (1 - s / 100 * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

function ColorPanel({ initialHex, onChange, onClose, id, anchorRef }: { initialHex: string; onChange: (color: LinkColor) => void; onClose: (restoreFocus?: boolean) => void; id: string; anchorRef: RefObject<HTMLButtonElement | null> }) {
  const panel = useRef<HTMLDivElement>(null);
  const exit = useRef<Animation | null>(null);
  const closing = useRef(false);
  const requestClose = useCallback((restoreFocus = true) => {
    if (closing.current) return;
    closing.current = true;
    const node = panel.current!;
    if (restoreFocus) anchorRef.current?.focus({ preventScroll: true });
    node.inert = true;
    node.dataset.state = "closing";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(false); return; }
    const current = getComputedStyle(node);
    exit.current = node.animate([
      { opacity: current.opacity, transform: current.transform },
      { opacity: 0, transform: "translateY(4px)" },
    ], { duration: 140, easing: "ease-in", fill: "forwards" });
    exit.current.onfinish = () => onClose(false);
  }, [anchorRef, onClose]);
  useLayoutEffect(() => () => {
    if (exit.current) { exit.current.onfinish = null; exit.current.cancel(); }
  }, []);
  useLayoutEffect(() => {
    const node = panel.current!, button = anchorRef.current!;
    node.showPopover();
    const position = () => {
      const rect = button.getBoundingClientRect();
      const width = node.offsetWidth, height = node.offsetHeight;
      const side = rect.right + width + 8 <= window.innerWidth - 12 ? rect.right + 8 : rect.left - width - 8 >= 12 ? rect.left - width - 8 : null;
      node.style.left = `${Math.max(12, Math.min(side ?? rect.left, window.innerWidth - width - 12))}px`;
      const top = side !== null ? rect.top : rect.bottom + height + 8 <= window.innerHeight - 12 ? rect.bottom + 8 : rect.top - height - 8;
      node.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
    };
    position();
    node.querySelector<HTMLInputElement>('input[type="range"]')?.focus({ preventScroll: true });
    const outside = (event: Event) => { if (!node.contains(event.target as Node) && !button.contains(event.target as Node)) requestClose(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
    };
    const observer = new ResizeObserver(position);
    observer.observe(node);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [anchorRef, requestClose]);
  // Keep HSV coordinates while editing: black/gray HEX cannot retain hue or saturation.
  const [hsv, setHSV] = useState(() => fromHex(initialHex));
  const [hexText, setHexText] = useState(initialHex);
  const invalid = !isCustomLinkColor(hexText);
  const hex = toHex(hsv);
  function update(next: HSV) { setHSV(next); const color = toHex(next); setHexText(color); onChange(color); }
  function point(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.closest("fieldset:disabled")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    update({ ...hsv, s: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), v: Math.max(0, Math.min(100, 100 - (event.clientY - rect.top) / rect.height * 100)) });
  }
  return <div ref={panel} popover="manual" id={id} role="group" aria-label="Custom color picker" className={styles.colorPanel} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
  }}>
    <div className={styles.colorPanelHeader}><span>Custom color</span><button type="button" className={styles.close} aria-label="Close color picker" onClick={() => requestClose()}>×</button></div>
    <div className={styles.colorPlane} aria-hidden="true" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); point(event); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
      <span className={styles.colorCursor} style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hex }} />
    </div>
    <div className={styles.colorSliders}>{([["h", "Hue", 359], ["s", "Saturation", 100], ["v", "Brightness", 100]] as const).map(([key, label, max]) => <div key={key}>
      <div className={styles.hueLabel}><label htmlFor={`${id}-${key}`}>{label}</label><span>{Math.round(hsv[key])}{key === "h" ? "°" : "%"}</span></div>
      <input id={`${id}-${key}`} className={styles.hueSlider} type="range" min="0" max={max} value={hsv[key]} onChange={event => update({ ...hsv, [key]: Number(event.target.value) })}
        style={key === "h" ? undefined : { background: key === "s" ? `linear-gradient(to right, white, hsl(${hsv.h} 100% 50%))` : `linear-gradient(to right, black, ${toHex({ ...hsv, v: 100 })})` }} />
    </div>)}</div>
    <div className={styles.hexRow}><span className={styles.colorSample} style={{ background: hex }} aria-hidden="true" /><label htmlFor={`${id}-hex`}>HEX</label>
      <input id={`${id}-hex`} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} value={hexText} spellCheck={false} autoComplete="off" maxLength={7}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!invalid) requestClose(); } }}
        onBlur={() => { if (invalid) setHexText(hex); }}
        onChange={event => { const color = event.target.value; setHexText(color); if (isCustomLinkColor(color)) { const next = fromHex(color); setHSV({ ...next, h: next.s ? next.h : hsv.h }); onChange(color.toLowerCase() as LinkColor); } }} />
    </div>
    {invalid && <p id={`${id}-error`} className={styles.error}>Use # followed by six hexadecimal digits.</p>}
  </div>;
}

export default function LinkColorPicker({ value, onChange }: { value: LinkColor; onChange: (color: LinkColor) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const hex = isCustomLinkColor(value) ? value : presetHex[value as keyof typeof presetHex] ?? presetHex.blue;
  const close = useCallback((restoreFocus = true) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); }, []);
  return <fieldset className={styles.colorPicker}>
    <legend className={styles.legend}>COLOR</legend>
    <div className={styles.colorToolbar}>
      <div className={styles.choices}>{linkColors.map(color => <button type="button" key={color} aria-label={`${color} color`} aria-pressed={value === color} onClick={() => { setOpen(false); onChange(color); }}>
        <span className={styles.colorDot} style={{ background: `var(--accent-${color})` }} />
      </button>)}</div>
      <button ref={trigger} type="button" className={styles.customColor} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>Custom
        <span className={styles.colorDot} style={{ background: isCustomLinkColor(value) ? hex : `var(--accent-${value})` }} />
      </button>
    </div>
    {open && <ColorPanel id={id} anchorRef={trigger} initialHex={hex} onChange={onChange} onClose={close} />}
  </fieldset>;
}
