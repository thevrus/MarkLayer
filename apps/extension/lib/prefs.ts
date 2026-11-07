import { signal } from '@preact/signals';
import type { OutputDetail } from './selector';
import { lsGet, lsSet, onHydrate, persistedFlag } from './storage';

export type Theme = 'system' | 'light' | 'dark';
const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';
export const theme = signal<Theme>('light');
onHydrate(() => {
  const stored = lsGet('ml-theme');
  if (isTheme(stored)) theme.value = stored;
});
export function cycleTheme() {
  const order: Theme[] = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(theme.value) + 1) % order.length] ?? 'light';
  theme.value = next;
  lsSet('ml-theme', next);
}

const SWATCHES = [
  { hex: '#b462f5', name: 'Purple' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#facc15', name: 'Yellow' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#f43f5e', name: 'Red' },
];
export const PALETTE = SWATCHES.map((s) => s.hex);
const DEFAULT_COLOR = '#f43f5e';

/**
 * The readable name of a palette colour, for the swatch label in the toolbar and
 * the picker — nobody reads a hex as a colour. Keyed by hex rather than by index
 * so a value restored from storage that is no longer in the palette still labels
 * itself, falling back to the hex it actually is.
 */
export function colorName(hex: string): string {
  return SWATCHES.find((s) => s.hex === hex.toLowerCase())?.name ?? hex.toUpperCase();
}

export const color = signal(DEFAULT_COLOR);
onHydrate(() => {
  color.value = lsGet('ml-color') || color.peek();
});

export function setColor(c: string) {
  color.value = c;
  lsSet('ml-color', c);
}

export const lineWidth = signal(2);

export const [toolbarMinimized, toggleToolbarMinimized] = persistedFlag({ key: 'ml-toolbar-min', fallback: false });

/** Show the framework component badge (React/Vue/Svelte) in the inspector hover + panel. */
export const [showFrameworkBadges] = persistedFlag({
  key: 'ml-framework-badges',
  fallback: true,
});

/** Show all annotation markers (pins, highlights, drawings, areas). When false, the canvas + overlays still render the active tool, but committed ops are hidden. */
export const [markersVisible, toggleMarkersVisible] = persistedFlag({ key: 'ml-markers-visible', fallback: true });

/** Swallow page clicks while extension is open — useful when annotating links/buttons that would otherwise navigate. */
export const [blockInteractions, toggleBlockInteractions] = persistedFlag({
  key: 'ml-block-interactions',
  fallback: false,
});

/** Auto-clear the inspector stack after copy/send so the next handoff starts fresh. */
export const [clearOnCopyEnabled, toggleClearOnCopy] = persistedFlag({ key: 'ml-clear-on-copy', fallback: false });

/**
 * Verbosity of the AI markdown emitted by `formatForAI`, modeled on Agentation's
 * four-tier ladder (defined in `selector.ts`). Each level is a strict superset.
 */
export const isOutputDetail = (v: unknown): v is OutputDetail =>
  v === 'compact' || v === 'standard' || v === 'detailed' || v === 'forensic';
export const outputDetail = signal<OutputDetail>('standard');
onHydrate(() => {
  const stored = lsGet('ml-output-detail');
  // Migrate the previous two-tier values: 'full' was the everything-on option.
  if (isOutputDetail(stored)) outputDetail.value = stored;
  else if (stored === 'full') outputDetail.value = 'forensic';
});

export function setOutputDetail(v: OutputDetail) {
  outputDetail.value = v;
  lsSet('ml-output-detail', v === 'standard' ? null : v);
}
