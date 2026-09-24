/**
 * A small bridge from the (non-React) action layer to the canvas. GraphCanvas registers its React Flow
 * helpers here while mounted; without a canvas (e.g. in unit tests) every call is a harmless no-op.
 */

export interface ViewportBridge {
  /** Centre of the visible canvas in flow coordinates. */
  center(): { x: number; y: number };
  /** Pan (animated) so the node is visible, if it isn't already. */
  reveal(nodeId: string): void;
  /** Select the node and centre the view on it. */
  focus(nodeId: string): void;
  /** Fit the whole graph into view (animated). */
  fit(): void;
}

let bridge: ViewportBridge | null = null;

export function registerViewport(b: ViewportBridge | null) {
  bridge = b;
}

export const viewport = {
  center: () => bridge?.center(),
  reveal: (id: string) => bridge?.reveal(id),
  focus: (id: string) => bridge?.focus(id),
  fit: () => bridge?.fit(),
};
