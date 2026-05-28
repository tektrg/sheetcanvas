/**
 * Design System Tokens — single source of truth for all brand colours.
 *
 * CSS layer  → index.html <style>  reads these as  var(--color-accent)
 * Tailwind   → index.html config   aliases  bg-accent / text-accent / …
 * JS / canvas → import { COLORS } from './theme'
 *
 * Rule: never hardcode a colour hex anywhere else in the codebase.
 * Light-mode values are the canonical defaults; dark overrides live in COLORS_DARK.
 */

export const COLORS = {
  /** Primary brand accent — teal-600 */
  accent: '#0d9488',
  /** Accent hover / pressed state — teal-700 */
  accentHover: '#0f766e',
  /** Accent at very low opacity — used for selection backgrounds */
  accentMuted: 'rgba(13, 148, 136, 0.14)',
} as const;

export const COLORS_DARK = {
  /** Primary brand accent in dark mode — teal-500 */
  accent: '#14b8a6',
  /** Accent hover in dark mode — teal-600 */
  accentHover: '#0d9488',
  /** Accent muted in dark mode */
  accentMuted: 'rgba(20, 184, 166, 0.2)',
} as const;

export type Colors = typeof COLORS;
