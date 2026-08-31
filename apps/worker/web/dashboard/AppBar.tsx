import { Menu } from '@base-ui/react/menu';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { cn } from '@marklayer/types';
import { ChevronDown } from 'lucide-preact';
import { Logo } from '../shared';
import { signOut, user } from './session';

/** One measure for the bar and the page under it, so the wordmark and the first
 *  row of content sit on the same left edge at every width. */
export const APP_MEASURE = 'mx-auto w-full max-w-[52rem] px-5 sm:px-6';

function AccountMenu({ email }: { email: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          geist.ctl,
          geist.ctlIdle,
          '-mr-2 ml-auto w-auto max-w-[16rem] gap-1.5 px-2 text-meta font-medium',
          'data-popup-open:bg-(--ds-gray-alpha-100) data-popup-open:text-(--ds-gray-1000)',
        )}
      >
        <span class="hidden truncate sm:inline">{email}</span>
        <span class="sm:hidden">Account</span>
        <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50 outline-none">
          <Menu.Popup className={cn(geist.surface, glass.menuPopup, 'min-w-[13rem] p-1')}>
            {/* The address, spelled out once. The trigger truncates it; a menu
                that opens without confirming which account you are in is the
                one place that truncation actually costs something. */}
            <p class="text-meta truncate px-2 py-1.5 text-(--ds-gray-900)">{email}</p>
            <div class={cn(geist.divider, 'my-1 -mx-1')} />
            <Menu.Item
              closeOnClick
              onClick={() => void signOut()}
              className={cn(glass.menuItem, glass.menuItemHighlight, 'text-ui flex h-8 items-center rounded-md px-2')}
            >
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The bar every signed-in /app screen sits under. A hairline and no shadow —
 * `geist.bar` encodes why: a bar is welded to the page it belongs to.
 */
export function AppBar() {
  const account = user.value;
  return (
    <header class={cn(geist.bar, 'sticky top-0 z-10')}>
      <div class={cn(APP_MEASURE, 'flex h-14 items-center gap-3')}>
        <a
          href="/"
          class={cn(
            // -mx-2 so the mark itself sits on the page's left margin and the hover
            // fill grows outward, rather than the padding pushing the lockup off it.
            '-ml-2 flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 no-underline',
            'transition-colors duration-150 hover:bg-(--ds-gray-alpha-100)',
          )}
        >
          <Logo size={20} />
          <span class="text-ui tracking-ui font-semibold text-(--ds-gray-1000)">MarkLayer</span>
        </a>
        {account ? <AccountMenu email={account.email} /> : null}
      </div>
    </header>
  );
}
