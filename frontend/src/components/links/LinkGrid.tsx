"use client";

import { Component, createRef, type ReactNode } from "react";
import styles from "./Links.module.css";

type Props = { order: number[]; children: ReactNode; boundary?: { id: number; direction: number } };
type Positions = Map<string, DOMRect>;

// Capture positions before React moves keyed cards, including any in-flight motion.
export default class LinkGrid extends Component<Props> {
  private grid = createRef<HTMLDivElement>();
  private motions: Animation[] = [];

  getSnapshotBeforeUpdate(previous: Props): Positions | null {
    const next = this.props.order;
    if (previous.order.join() === next.join() || previous.order.length !== next.length ||
      previous.order.some(id => !next.includes(id))) return null;
    return new Map(Array.from(this.grid.current?.children ?? []).map(node => [
      (node as HTMLElement).dataset.linkId!, node.getBoundingClientRect(),
    ]));
  }

  async exitBoundary(id: number, direction: number) {
    this.cancelMotion();
    const node = this.grid.current?.querySelector<HTMLElement>(`[data-link-id="${id}"]`);
    if (!node || typeof node.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = node.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${direction * 18}px)` }],
      { duration: 160, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    this.motions.push(animation);
    await new Promise<void>(resolve => { animation.onfinish = () => resolve(); animation.oncancel = () => resolve(); });
  }

  componentDidUpdate(_previous: Props, _state: unknown, positions: Positions | null) {
    if (this.props.boundary && this.props.boundary !== _previous.boundary) {
      this.cancelMotion();
      const { id, direction } = this.props.boundary;
      const node = this.grid.current?.querySelector<HTMLElement>(`[data-link-id="${id}"]`);
      if (node && typeof node.animate === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.motions.push(node.animate([{ opacity: 0, transform: `translateX(${-direction * 18}px)` }, { opacity: 1, transform: "translateX(0)" }],
          { duration: 240, easing: "cubic-bezier(.22, 1, .36, 1)" }));
      }
      return;
    }
    if (!positions) return;
    this.cancelMotion();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const node of Array.from(this.grid.current?.children ?? [])) {
      const before = positions.get((node as HTMLElement).dataset.linkId!);
      const after = node.getBoundingClientRect();
      if (!before || (before.x === after.x && before.y === after.y)) continue;
      this.motions.push(node.animate([
        { transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)` },
        { transform: "translate(0, 0)" },
      ], { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)" }));
    }
  }

  private cancelMotion() {
    this.motions.forEach(motion => motion.cancel());
    this.motions = [];
  }

  componentWillUnmount() { this.cancelMotion(); }

  render() { return <div ref={this.grid} className={`${styles.grid} editor-resource-grid`}>{this.props.children}</div>; }
}
