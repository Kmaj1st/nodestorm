import type { LucideIcon } from "lucide-react";

/**
 * The one way to draw an icon (lucide-react, imported per icon so the bundle holds only the ones used).
 *
 * Conventions:
 * - Icons are decoration: always `aria-hidden`. The control around them carries the name: a visible label, or for an
 *   icon-only button an `aria-label` plus a `title` tooltip.
 * - 16px by default, 14px in dense places (badges, small buttons, list rows), 20px for empty states.
 * - Stroke 1.75 and `currentColor`, so an icon takes the colour (and hover/disabled state) of its text.
 * - No emoji or pictographic characters as icons anywhere in the UI (key names such as ⌘ ⇧ in the shortcuts list are
 *   key notation, not icons).
 */
export function Icon({ icon: Glyph, size = 16, className }: { icon: LucideIcon; size?: 12 | 14 | 16 | 20 | 24; className?: string }) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : "icon"}
    />
  );
}
