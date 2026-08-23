// DeepSeek Harness brand wordmark (figma 356:14644, exact extract): whale +
// "deepseek-official" letterforms + HARNESS badge plate in one svg. Native 182x24.
// Ink rides currentColor; the badge text is knocked out in the inverted
// label color so the plate stays legible in both themes.

import type { IconProps } from './icons/props.ts'

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the 182:24 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * 182) / 24}
      height={size}
      className={className}
      viewBox="0 0 182 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 3H21L20 5L8 15H21L19 18H3L4 16L16 6H3L3 3Z" fill="currentColor"/>
    </svg>
  )
}
