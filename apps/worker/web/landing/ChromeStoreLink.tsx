import { CHROME_STORE_URL } from '@marklayer/brand';
import { cn } from '@marklayer/ui/cn';
import { siGooglechrome } from 'simple-icons';
import { capture } from '../analytics';
import { CTA_CLS } from './content';

/* Declared at module scope, not in the render body. Landing re-renders on every
   signal read it makes — the active tool, the op list, the toast queue — and a
   component declared inside it is a new type each time, so Preact would unmount
   and remount this SVG on all of them. */
export function ChromeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={siGooglechrome.path} />
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
