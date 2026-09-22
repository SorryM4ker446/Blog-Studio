"use client";

import { cloneElement, useEffect, useLayoutEffect, useRef } from "react";
import MdEditor from "react-markdown-editor-lite";
import type { ComponentProps } from "react";

// Match the server default during hydration. The upstream mount lifecycle
// restores the browser language after the initial tree has committed.
const { useLocale: setEditorLocale } = MdEditor;
setEditorLocale("enUS");

// The upstream editor defers preview rendering until mount. Seed its public
// state with our synchronous renderer so SSR and hydration show the same body.
class PrerenderedEditor extends MdEditor {
  constructor(props: ComponentProps<typeof MdEditor>) {
    super(props);
    const html = props.renderHTML(this.state.text);
    if (typeof html === "string") this.state = { ...this.state, html };
  }

  componentDidMount() {
    super.componentDidMount();
    // Locale detection changes after hydration, but the upstream plugin
    // elements are cached. Refresh their props without replacing their nodes.
    this.setState(({ plugins }) => ({ plugins: Object.fromEntries(
      Object.entries(plugins).map(([position, elements]) => [position, elements.map(element => cloneElement(element))]),
    ) }));
  }
}

// The upstream toolbar uses spans; keep its commands while exposing keyboard controls.
type MarkdownEditorProps = ComponentProps<typeof MdEditor> & { invalid?: boolean; errorId?: string };

export default function MarkdownEditor({ invalid, errorId, ...props }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The upstream component does not forward accessibility props to its textarea.
  useLayoutEffect(() => {
    const input = rootRef.current?.querySelector("textarea");
    if (!input) return;
    input.setAttribute("aria-required", "true");
    input.setAttribute("aria-invalid", String(Boolean(invalid)));
    if (errorId) input.setAttribute("aria-describedby", errorId);
    else input.removeAttribute("aria-describedby");
  }, [invalid, errorId]);
  const pendingMenuRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const enhance = () => {
      root.querySelectorAll<HTMLElement>(".rc-md-navigation .button[title], .tool-bar .button[title]").forEach(control => {
        const fileInput = control.querySelector<HTMLInputElement>('input[type="file"]');
        if (fileInput) {
          fileInput.setAttribute("aria-label", control.title);
          control.removeAttribute("role");
          control.removeAttribute("tabindex");
          return;
        }
        const dropdown = control.querySelector(".drop-wrap");
        const trigger = dropdown ? control.firstElementChild as HTMLElement : control;
        if (!trigger) return;
        trigger.setAttribute("role", "button");
        trigger.setAttribute("aria-label", control.title);
        trigger.tabIndex = control.classList.contains("disabled") ? -1 : 0;
        trigger.setAttribute("aria-disabled", String(control.classList.contains("disabled")));
        if (dropdown) trigger.setAttribute("aria-expanded", String(dropdown.classList.contains("show")));
      });
      root.querySelectorAll<HTMLElement>(".header-list .list-item > *, .table-list .list-item").forEach(item => {
        item.setAttribute("role", "button");
        item.tabIndex = 0;
        const cells = Array.from(item.parentElement?.children ?? []) as HTMLElement[];
        const row = [...new Set(cells.map(cell => cell.style.top))].indexOf(item.style.top) + 1;
        const col = cells.filter(cell => cell.style.top === item.style.top).indexOf(item) + 1;
        item.setAttribute("aria-label", item.textContent?.trim() || `Insert table: ${row} rows, ${col} columns`);
      });
      root.querySelectorAll(".table-list").forEach(list => list.setAttribute("role", "presentation"));
      const pending = pendingMenuRef.current;
      if (pending?.querySelector(".drop-wrap.show")) {
        pendingMenuRef.current = null;
        pending.querySelector<HTMLElement>('.drop-wrap [role="button"]')?.focus();
      }
    };
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "title"] });
    return () => observer.disconnect();
  }, []);

  return <div ref={rootRef} onBlur={event => {
    const control = (event.target as HTMLElement).closest<HTMLElement>(".button");
    if (control?.querySelector(".drop-wrap") && !control.contains(event.relatedTarget)) {
      if (pendingMenuRef.current === control) pendingMenuRef.current = null;
      control.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: rootRef.current }));
    }
  }} onKeyDown={event => {
    const target = event.target as HTMLElement;
    if (target.getAttribute("role") !== "button" || target.getAttribute("aria-disabled") === "true") return;
    const dropdown = target.closest(".drop-wrap");
    if (dropdown && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const choices = Array.from(dropdown.querySelectorAll<HTMLElement>('[role="button"]'));
      const index = choices.indexOf(target);
      const offset = ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1;
      choices[event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + offset + choices.length) % choices.length]?.focus();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const control = target.closest<HTMLElement>(".button");
      if (control?.querySelector(".drop-wrap") && !target.closest(".drop-wrap")) {
        pendingMenuRef.current = control;
        control.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        if (control.querySelector(".drop-wrap.show")) {
          pendingMenuRef.current = null;
          control.querySelector<HTMLElement>('.drop-wrap [role="button"]')?.focus();
        }
      } else target.click();
    }
    if (event.key === "Escape") {
      pendingMenuRef.current = null;
      const parent = target.closest<HTMLElement>(".button");
      parent?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: rootRef.current }));
      (parent?.querySelector<HTMLElement>('[aria-expanded]') ?? parent)?.focus();
    }
  }}><PrerenderedEditor {...props} /></div>;
}
