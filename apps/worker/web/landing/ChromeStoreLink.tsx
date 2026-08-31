import { cn } from '@marklayer/types';
import { CHROME_STORE_URL } from '@site/lib/site';
import { capture } from '../analytics';
import { CTA_CLS } from './content';

/* Declared at module scope, not in the render body. Landing re-renders on every
   signal read it makes — the active tool, the op list, the toast queue — and a
   component declared inside it is a new type each time, so Preact would unmount
   and remount this SVG on all of them. */
export function ChromeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="21.17" y1="8" x2="12" y2="8" />
      <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
      <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
    </svg>
  );
}

/** The one install call to action, used at the fold and again above the footer. */
export function ChromeStoreLink({ label, class: cls, at }: { label: string; class?: string; at: string }) {
  return (
    <a
      href={CHROME_STORE_URL}
      target="_blank"
      rel="noopener"
      class={cn(CTA_CLS, cls)}
      onClick={() => capture('extension_install_clicked', { at })}
    >
      <ChromeIcon />
      {label}
    </a>
  );
}
