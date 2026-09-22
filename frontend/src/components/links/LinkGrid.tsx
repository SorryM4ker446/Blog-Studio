"use client";

import { Component, createRef, type ReactNode } from "react";
import styles from "./Links.module.css";

type Props = { order: number[]; children: ReactNode };
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

  componentDidUpdate(_previous: Props, _state: unknown, positions: Positions | null) {
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

  render() { return <div ref={this.grid} className={styles.grid}>{this.props.children}</div>; }
}
