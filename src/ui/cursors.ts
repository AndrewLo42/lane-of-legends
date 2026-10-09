/**
 * Custom mouse cursors, drawn as inline SVG so there's nothing to load. They're larger than the
 * system ones (32px) with a dark outline, so they stay visible over the lane and easy to aim:
 * - `normal`: a gold arrow, hotspot at its tip.
 * - `attack`: a red reticle over an enemy you can attack, hotspot in the centre.
 * - `aim`: a pale reticle while an ability or summoner spell is held, hotspot in the centre.
 */
/** Drawn on a 40-unit grid and shown at SIZE px; hotspots are scaled to match. */
const SIZE = 32;
const hot = (n: number) => Math.round((n * SIZE) / 40);

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 40 40">${body}</svg>`)}`;

const ARROW = svg(`
  <path d="M5 3 L5 31 L12.5 24.5 L17.5 36 L23 33.5 L18 22.5 L28 22.5 Z" fill="#1a1206" stroke="#1a1206" stroke-width="4" stroke-linejoin="round"/>
  <path d="M5 3 L5 31 L12.5 24.5 L17.5 36 L23 33.5 L18 22.5 L28 22.5 Z" fill="#ffd76a" stroke="#fff3c4" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M7.5 9 L7.5 24 L12 20" fill="none" stroke="#fff8dc" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/>`);

/** A ring with four ticks and a centre dot, outlined so it reads on any ground. */
const reticle = (color: string, glow: string) =>
  svg(`
  <g fill="none" stroke="#120808" stroke-width="5" stroke-linecap="round">
    <circle cx="20" cy="20" r="11"/>
    <path d="M20 2 V9 M20 31 V38 M2 20 H9 M31 20 H38"/>
  </g>
  <g fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round">
    <circle cx="20" cy="20" r="11"/>
    <path d="M20 2 V9 M20 31 V38 M2 20 H9 M31 20 H38"/>
  </g>
  <circle cx="20" cy="20" r="3" fill="#120808"/>
  <circle cx="20" cy="20" r="1.8" fill="${glow}"/>`);

export const CURSOR = {
  normal: `url("${ARROW}") ${hot(5)} ${hot(3)}, default`,
  attack: `url("${reticle('#ff4a3d', '#ffd0c8')}") ${hot(20)} ${hot(20)}, crosshair`,
  aim: `url("${reticle('#d9f4ff', '#ffffff')}") ${hot(20)} ${hot(20)}, crosshair`,
} as const;

/** Use the custom arrow everywhere (menus included); the game canvas swaps in the others. */
export function installCursors() {
  document.documentElement.style.setProperty('--cursor', CURSOR.normal);
}
