import type { FrameworkComponent } from '../lib/fiber-bridge';
import { BrandIcon, type BrandIconName } from '../lib/icons';
import { showFrameworkBadges } from '../lib/prefs';
import { shortClassLabel } from '../lib/selector';

export interface HoverState {
  el: Element;
  rect: DOMRect;
  /** Lazily filled after an 80ms debounce — `getSelector` walks the DOM. */
  selector: string | null;
  /** Lazily filled after the same debounce — costs a CustomEvent round-trip to the bridge. */
  component: FrameworkComponent | null;
}

/** Hue per framework — React cyan, Vue green, Svelte orange. Match brand colors approximately. */
export const FRAMEWORK_HUES: Record<FrameworkComponent['framework'], number> = { React: 220, Vue: 155, Svelte: 30 };

export function frameworkColor(framework: FrameworkComponent['framework']): string {
  return `oklch(0.88 0.11 ${FRAMEWORK_HUES[framework]})`;
}

function frameworkBadgeStyle(framework: FrameworkComponent['framework']) {
  const hue = FRAMEWORK_HUES[framework];
  return {
    background: `oklch(0.65 0.16 ${hue} / 0.24)`,
    color: `oklch(0.88 0.11 ${hue})`,
  };
}

export const FRAMEWORK_BRAND: Record<FrameworkComponent['framework'], BrandIconName> = {
  React: 'react',
  Vue: 'vue',
  Svelte: 'svelte',
};

export function HoverTooltip({ state }: { state: HoverState }) {
  const { el, rect, selector, component } = state;
  const tag = el.tagName.toLowerCase();
  const id = el.id;
  const classes = shortClassLabel(el);
  const top = Math.max(4, rect.top - 32);
  const componentName = component?.chain[0];
  return (
    <div
      class="fixed z-2147483647 pointer-events-none inline-flex items-center gap-2 rounded-[8px]
             whitespace-nowrap font-mono text-meta leading-none tracking-label
             animate-[fadeIn_140ms_ease-out]"
      style={{
        left: rect.left,
        top,
        padding: '5px 9px 5px 6px',
        background: 'oklch(0.22 0.015 300 / 0.96)',
        color: 'oklch(0.92 0.01 300)',
        border: '1px solid oklch(1 0 0 / 0.06)',
        boxShadow:
          '0 1px 0 0 oklch(1 0 0 / 0.05) inset, 0 6px 20px oklch(0 0 0 / 0.35), 0 0 0 0.5px oklch(0 0 0 / 0.4)',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)',
        transition: 'left 80ms ease, top 80ms ease, opacity 120ms ease',
      }}
    >
      {showFrameworkBadges.value && component && componentName && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px 2px 5px',
            borderRadius: 5,
            fontWeight: 600,
            fontSize: 10.5,
            letterSpacing: '0.01em',
            ...frameworkBadgeStyle(component.framework),
          }}
        >
          <BrandIcon name={FRAMEWORK_BRAND[component.framework]} size={11} />
          {componentName}
        </span>
      )}
      <span
        style={{
          padding: '2px 6px',
          borderRadius: 5,
          background: 'color-mix(in oklab, var(--ds-blue-800) 20%, transparent)',
          color: 'oklch(0.86 0.08 300)',
          fontWeight: 600,
          fontSize: 10.5,
          letterSpacing: '0.02em',
        }}
      >
        {tag}
      </span>
      {id ? (
        <span style={{ color: 'oklch(0.78 0.14 145)' }}>#{id}</span>
      ) : classes ? (
        <span style={{ color: 'oklch(0.78 0.13 80)' }}>.{classes}</span>
      ) : selector ? (
        <span style={{ color: 'oklch(0.7 0.04 260)' }}>
          {selector.length > 48 ? `…${selector.slice(-47)}` : selector}
        </span>
      ) : null}
      <span style={{ color: 'oklch(1 0 0 / 0.18)' }}>·</span>
      <span style={{ color: 'oklch(1 0 0 / 0.5)', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(rect.width)}×{Math.round(rect.height)}
      </span>
    </div>
  );
}
