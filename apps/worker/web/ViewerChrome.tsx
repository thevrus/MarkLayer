import { Menu } from '@base-ui/react/menu';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Avatar } from '@ext/components/Avatar';
import { IdentityCard } from '@ext/components/IdentityCard';
import { Tooltip } from '@ext/components/Tooltip';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import {
  copyText,
  cycleTheme,
  elementToolsUnavailable,
  peerCount,
  peers,
  showAnnotationPanel,
  theme,
} from '@ext/lib/state';
import type { DeviceMode } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import {
  Check,
  ChevronDown,
  Heart,
  Info,
  Link,
  MessageSquare,
  Mic,
  MicOff,
  MonitorCog,
  MonitorPlay,
  Moon,
  Sun,
  Upload,
  Video,
  VideoOff,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useRef, useState } from 'preact/hooks';
import { isUploadPath } from './pdfSource';
import { DEVICE_ICONS, Logo } from './shared';
import {
  deviceMode,
  isReadonly,
  navigateTo,
  onFollowScroll,
  pageUrl,
  presenting,
  setPresenting,
  sharing,
  showInfoPanel,
  type ViewerZoom,
  viewerZoom,
  ZOOM_PRESETS,
} from './signals';
import { openSupportCard } from './support-ui';
import { connected } from './useRealtimeSync';
import { useViewerFrame } from './viewerFrame';
import { videoActive, voiceActive, voiceMuted } from './voiceSignals';

// Only fetched when a user joins voice/video or opens the device picker.
const DeviceMenu = lazy(() => import('./DeviceMenu').then((m) => ({ default: m.DeviceMenu })));

// Peers shown before collapsing the rest into a "+N" badge. The local user sits
// at index 0, so the overflow badge lands at MAX_VISIBLE_PEERS + 1 in the group.
const MAX_VISIBLE_PEERS = 3;

/* ── Top bar ──
   Each control below owns the signals it reads, so the bar itself is a
   composition rather than a render with a dozen flags threaded through it. */

/** Presence: a solid dot in a ring of its own colour, never a glow. */
export function PresenceDot({ live }: { live: boolean }) {
  return (
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0"
      style={
        live
          ? {
              background: 'var(--ds-green-700)',
              boxShadow: '0 0 0 3px color-mix(in oklab, var(--ds-green-700) 20%, transparent)',
            }
          : { background: 'var(--ds-gray-700)' }
      }
    />
  );
}

/** Icon control in the bar. `on` is the control's state, not a style variant. */
export function BarButton({
  icon,
  tip,
  onClick,
  on,
  disabled,
}: {
  icon: ComponentChildren;
  tip: string;
  onClick: () => void;
  on?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tip}
      class={cn(geist.ctl, on ? geist.ctlOn : geist.ctlIdle, disabled && 'opacity-50 pointer-events-none')}
    >
      {icon}
      <Tooltip text={tip} placement="bottom" />
    </button>
  );
}

function BrandLink() {
  return (
    <a
      href="/"
      class={cn(
        'flex items-center gap-1.5 h-8 px-2 rounded-md no-underline shrink-0 cursor-pointer',
        'hover:bg-(--ds-gray-alpha-100) transition-colors duration-150',
      )}
    >
      <Logo size={20} />
      <span class="text-ui font-semibold tracking-ui text-(--ds-gray-1000)">MarkLayer</span>
    </a>
  );
}

/** The page being annotated: editable, Enter to navigate, click the icon to copy.
 *  An uploaded file has no url worth either — the path describes nothing to a
 *  reader, and copying it yields a relative fragment rather than a link (the
 *  shareable one comes from the share button). So the field keeps only its
 *  second job there: somewhere to type the next page. */
function UrlField() {
  const uploaded = isUploadPath(pageUrl.value);
  return (
    <div class={cn(geist.field, 'flex-1 min-w-0 flex items-center gap-2 px-2.5')}>
      {!uploaded && (
        <Link
          size={14}
          strokeWidth={1.5}
          class="text-(--ds-gray-900) shrink-0 cursor-pointer hover:text-(--ds-gray-1000) transition-colors duration-150"
          aria-label="Copy URL"
          onClick={() => copyText(pageUrl.value, 'URL copied')}
        />
      )}
      <input
        name="pageUrl"
        type="text"
        placeholder={uploaded ? 'Paste a URL to annotate…' : undefined}
        defaultValue={uploaded ? '' : pageUrl.value}
        class={cn(geist.input, 'flex-1 truncate cursor-text')}
        title="Edit URL and press Enter to navigate"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          let url = e.currentTarget.value.trim();
          if (!url) return;
          if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
          navigateTo({ url, source: 'url_bar' });
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

const VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
const viewportLabel = (m: DeviceMode) => `${m.charAt(0).toUpperCase() + m.slice(1)} viewport`;

function ViewportToggle({ mode }: { mode: DeviceMode }) {
  const Icon = DEVICE_ICONS[mode];
  const label = viewportLabel(mode);
  return (
    <Toggle value={mode} aria-label={label} className={geist.segment}>
      <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
      <Tooltip text={label} placement="bottom" />
    </Toggle>
  );
}

/** Mutually exclusive views, so the selection reads as a panel raised off a track. */
function ViewportSwitcher() {
  // A PDF is laid out to the frame's width, not by media queries — switching to a
  // phone viewport would only make the same page narrower, so it isn't offered.
  if (elementToolsUnavailable.value) return null;
  return (
    <ToggleGroup
      value={[deviceMode.value]}
      onValueChange={(next: DeviceMode[]) => {
        // One viewport is always shown, so an empty selection holds the current one.
        if (next[0]) deviceMode.value = next[0];
      }}
      aria-label="Viewport"
      className={geist.track}
    >
      {VIEWPORTS.map((mode) => (
        <ViewportToggle key={mode} mode={mode} />
      ))}
    </ToggleGroup>
  );
}

const zoomLabel = (z: ViewerZoom): string => (z === 'auto' ? 'Auto' : `${Math.round(z * 100)}%`);

function ZoomMenu() {
  const { state } = useViewerFrame();
  return (
    <Menu.Root open={state.zoomMenuOpen.value} onOpenChange={(next: boolean) => (state.zoomMenuOpen.value = next)}>
      <Menu.Trigger
        className={cn(
          geist.ctl,
          geist.ctlIdle,
          'w-auto min-w-16 gap-1 px-2 text-meta font-medium tabular-nums',
          'data-popup-open:bg-(--ds-gray-alpha-100) data-popup-open:text-(--ds-gray-1000)',
        )}
      >
        {zoomLabel(viewerZoom.value)}
        <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        <Tooltip text="Zoom" placement="bottom" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-2147483647 outline-none"
        >
          <Menu.Popup className={cn(geist.surface, glass.font, 'min-w-32 p-1')}>
            <Menu.RadioGroup
              value={viewerZoom.value}
              onValueChange={(next: ViewerZoom) => {
                viewerZoom.value = next;
              }}
            >
              {ZOOM_PRESETS.map((preset) => (
                <Menu.RadioItem
                  key={String(preset.value)}
                  value={preset.value}
                  closeOnClick
                  className={cn(
                    'flex items-center justify-between gap-3 h-8 px-2 rounded-md cursor-pointer outline-none',
                    'text-ui tabular-nums text-(--ds-gray-1000)',
                    'transition-colors duration-100 data-highlighted:bg-(--ds-gray-alpha-100)',
                  )}
                >
                  {preset.label}
                  <Menu.RadioItemIndicator className="inline-flex text-(--ds-gray-900)">
                    <Check size={14} strokeWidth={1.5} aria-hidden="true" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Dock-style hover spring for the avatar stack: the hovered avatar rises with a
 * slight scale and the lift ripples out, damped, across its neighbours. Writes
 * per-item CSS vars; the `.ml-avatar` class owns the transform and transition,
 * whose easings and duration these constants are matched to.
 */
const AVATAR_LIFT = -2;
const AVATAR_SCALE = 1.03;
const AVATAR_FALLOFF = 0.35;

function useAvatarSpring() {
  const groupRef = useRef<HTMLDivElement>(null);
  const eachChild = (fn: (el: HTMLElement, i: number) => void) => {
    const group = groupRef.current;
    if (!group) return;
    for (const [i, el] of Array.from(group.children).entries()) {
      if (el instanceof HTMLElement) fn(el, i);
    }
  };
  const spring = (activeIdx: number) =>
    eachChild((el, i) => {
      el.style.transitionTimingFunction = 'var(--ml-avatar-ease-in)';
      const shift = AVATAR_LIFT * AVATAR_FALLOFF ** Math.abs(i - activeIdx);
      el.style.setProperty('--shift', `${shift.toFixed(3)}px`);
      el.style.setProperty('--scale-active', i === activeIdx ? `${AVATAR_SCALE}` : '1');
    });
  const reset = () =>
    eachChild((el) => {
      el.style.transitionTimingFunction = 'var(--ml-avatar-ease-out)';
      el.style.setProperty('--shift', '0px');
      el.style.setProperty('--scale-active', '1');
    });
  return { groupRef, spring, reset };
}

/** The other people in the room. You are not in the stack — you are the
 *  IdentityCard trigger beside it, which is also where you rename yourself. */
function PresenceGroup() {
  const { groupRef, spring, reset } = useAvatarSpring();
  const visible = Array.from(peers.value.values()).slice(0, MAX_VISIBLE_PEERS);
  const overflow = peers.value.size - MAX_VISIBLE_PEERS;
  // The stack overlaps, so whoever is hovered has to come to the front —
  // otherwise the neighbour on top clips the name you are reaching for.
  const [hovered, setHovered] = useState<number | null>(null);
  const enter = (index: number) => () => {
    setHovered(index);
    spring(index);
  };
  const zOf = (index: number, base: number) => (hovered === index ? peers.value.size + 10 : base);

  if (!peers.value.size) return null;
  return (
    <div
      ref={groupRef}
      class="flex items-center -space-x-2 mx-1"
      onMouseLeave={() => {
        setHovered(null);
        reset();
      }}
    >
      {visible.map((p, i) => (
        <Avatar
          key={p.id}
          name={p.name}
          color={p.color}
          stacked
          dim={p.cursor == null}
          title={p.cursor != null ? p.name : `${p.name} (inactive)`}
          style={{ zIndex: zOf(i, peers.value.size - i) }}
          onMouseEnter={enter(i)}
          onClick={() => {
            if (p.cursor) onFollowScroll.value?.(p.cursor.y);
          }}
        />
      ))}
      {overflow > 0 && (
        <div
          class="ml-avatar w-6 h-6 rounded-full grid place-items-center shrink-0 bg-(--ds-gray-100) text-(--ds-gray-900) text-meta font-medium tabular-nums"
          style={{
            boxShadow: '0 0 0 1.5px var(--ds-gray-alpha-400), 0 0 0 3px var(--ds-background-100)',
            zIndex: zOf(MAX_VISIBLE_PEERS, 0),
          }}
          onMouseEnter={enter(MAX_VISIBLE_PEERS)}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function JoinVoiceControls() {
  return (
    <div class="flex items-center gap-0.5">
      <BarButton
        icon={<Mic size={16} strokeWidth={1.5} aria-hidden="true" />}
        tip="Join voice"
        onClick={() => {
          voiceActive.value = true;
        }}
      />
      <Suspense fallback={null}>
        <DeviceMenu hasPermission={false} />
      </Suspense>
    </div>
  );
}

function InCallControls() {
  return (
    <div class="flex items-center gap-0.5">
      <BarButton
        icon={
          voiceMuted.value ? (
            <MicOff size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Mic size={16} strokeWidth={1.5} aria-hidden="true" />
          )
        }
        tip={voiceMuted.value ? 'Unmute' : 'Mute'}
        on={!voiceMuted.value}
        onClick={() => {
          voiceMuted.value = !voiceMuted.value;
        }}
      />
      <BarButton
        icon={
          videoActive.value ? (
            <Video size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <VideoOff size={16} strokeWidth={1.5} aria-hidden="true" />
          )
        }
        tip={videoActive.value ? 'Turn off camera' : 'Turn on camera'}
        on={videoActive.value}
        onClick={() => {
          videoActive.value = !videoActive.value;
        }}
      />
      <Suspense fallback={null}>
        <DeviceMenu hasPermission />
      </Suspense>
    </div>
  );
}

function ConnectionStatus() {
  const live = connected.value;
  return (
    <div class="flex items-center gap-2 h-8 px-1.5 shrink-0">
      <PresenceDot live={live} />
      <span class={cn(geist.meta, 'text-meta font-medium tabular-nums whitespace-nowrap')}>
        {live ? `${peerCount.value} online` : 'offline'}
      </span>
    </div>
  );
}

/**
 * "Everyone follow me." Hidden when nobody else is in the room, because pulling
 * an empty room is a control that does nothing.
 */
function PresentButton() {
  if (!connected.value || peerCount.value < 2) return null;
  const on = presenting.value;
  return (
    <BarButton
      icon={<MonitorPlay size={16} strokeWidth={1.5} aria-hidden="true" />}
      tip={on ? 'Stop presenting' : 'Present to everyone'}
      on={on}
      onClick={() => setPresenting(!on)}
    />
  );
}

function ShareButton() {
  const {
    actions: { share },
  } = useViewerFrame();
  return (
    <BarButton
      icon={<Upload size={16} strokeWidth={1.5} aria-hidden="true" />}
      tip="Copy editable link"
      onClick={share}
      disabled={sharing.value}
    />
  );
}

/**
 * Paired with the card's own gate — a read-only visitor never renders the dialog,
 * so they must never get a button that opens nothing.
 *
 * Sized, stroked and coloured exactly like every other control in the bar. An
 * ask for money is the last thing that should be shouting from the chrome; the
 * tooltip says what it is and the card does the talking.
 */
function SupportButton() {
  return (
    <BarButton
      icon={<Heart size={16} strokeWidth={1.5} aria-hidden="true" />}
      tip="Support MarkLayer"
      onClick={() => openSupportCard('bar')}
    />
  );
}

/** One lookup rather than two parallel ternaries, so a theme cannot gain an icon without a name. */
const THEMES = {
  system: { Icon: MonitorCog, label: 'System' },
  dark: { Icon: Moon, label: 'Dark' },
  light: { Icon: Sun, label: 'Light' },
};

function ThemeButton() {
  const { Icon, label } = THEMES[theme.value];
  return (
    <BarButton
      icon={<Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
      tip={`Theme: ${label}`}
      onClick={cycleTheme}
    />
  );
}

export function ViewerTopBar() {
  return (
    <div class={cn('flex items-center gap-2 px-3 h-12 z-50 shrink-0', geist.bar)}>
      <BrandLink />
      <div class={geist.sep} />
      <UrlField />
      <BarButton
        icon={<Info size={16} strokeWidth={1.5} aria-hidden="true" />}
        tip="Annotation info"
        on={showInfoPanel.value}
        onClick={() => (showInfoPanel.value = !showInfoPanel.value)}
      />
      <div class={geist.sep} />
      <ViewportSwitcher />
      <ZoomMenu />
      <div class={geist.sep} />

      <div class="flex items-center gap-1 shrink-0">
        <IdentityCard />
        <PresenceGroup />
        {voiceActive.value ? <InCallControls /> : <JoinVoiceControls />}
        <ConnectionStatus />
        <PresentButton />
        <BarButton
          icon={<MessageSquare size={16} strokeWidth={1.5} aria-hidden="true" />}
          tip="Annotations panel"
          on={showAnnotationPanel.value}
          onClick={() => (showAnnotationPanel.value = !showAnnotationPanel.value)}
        />
        {!isReadonly.value && <ShareButton />}
        {!isReadonly.value && <SupportButton />}
        <ThemeButton />
      </div>
    </div>
  );
}
