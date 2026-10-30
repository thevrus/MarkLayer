import { Menu } from '@base-ui/react/menu';
import { useVideoNote, VideoButton, VideoDraft, VideoLive } from '@ext/components/VideoNote';
import { VideoPlayer } from '@ext/components/VideoPlayer';
import { secondaryBtn, submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { color, deleteOp, lineWidth, operations, pushOp, signedBy } from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import { cn, type IntroOp } from '@marklayer/types';
import { computed, signal, useSignal } from '@preact/signals';
import { ChevronDown, Ellipsis } from 'lucide-preact';
import { nanoid } from 'nanoid';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { capture } from './analytics';
import { menuItem } from './shared';
import { fileUrl, isReadonly, uploadVideo } from './signals';

/** In the room's append order, not by `ts`: a peer's skewed clock must not demote the take they just pinned. */
export const intros = computed(() => operations.value.filter((op): op is IntroOp => op.tool === 'intro'));

export const introComposerOpen = signal(false);

/** The version picked from the menu; null follows the newest, so a fresh take shows without a click. */
const pickedId = signal<string | null>(null);

/** The open composer; a read-only viewer never gets one, whatever the flag says. */
const composing = computed(() => introComposerOpen.value && !isReadonly.value);

/** The trigger plus the popup scaffold both intro menus share. */
function IntroMenu({
  trigger,
  children,
}: {
  trigger: { 'aria-label': string; title?: string; className: string; children: ComponentChildren };
  children: ComponentChildren;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger {...trigger} />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'min-w-48 p-1 flex flex-col gap-px')}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function VersionMenu({ list, shown }: { list: IntroOp[]; shown: IntroOp }) {
  const trigger = {
    'aria-label': 'Choose a version',
    className: cn(geist.ctlXs, geist.ctlIdle, geist.ctlLabel, 'tabular-nums'),
    children: (
      <>
        V{list.indexOf(shown) + 1}
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
      </>
    ),
  };
  return (
    <IntroMenu trigger={trigger}>
      {[...list].reverse().map((op, i) => (
        <Menu.Item
          key={op.id}
          className={cn(menuItem, op.id === shown.id && 'font-semibold')}
          onClick={() => {
            pickedId.value = i === 0 ? null : op.id;
            capture('intro_version_selected');
          }}
        >
          <span class="tabular-nums w-6">V{list.length - i}</span>
          <span class="flex-1 truncate">{op.author || 'Anonymous'}</span>
          <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(op.ts)}</span>
        </Menu.Item>
      ))}
    </IntroMenu>
  );
}

function IntroActions({ shown }: { shown: IntroOp }) {
  const trigger = {
    'aria-label': 'Intro video actions',
    title: 'More',
    className: cn(geist.ctlXs, geist.ctlIdle),
    children: <Ellipsis size={14} strokeWidth={1.5} aria-hidden="true" />,
  };
  return (
    <IntroMenu trigger={trigger}>
      <Menu.Item
        className={menuItem}
        onClick={() => {
          introComposerOpen.value = true;
          capture('intro_composer_opened');
        }}
      >
        Record a new version
      </Menu.Item>
      <Menu.Item
        className={cn(menuItem, 'data-highlighted:text-(--ds-red-700)')}
        onClick={() => {
          // deleteOp has no undo, and the take may be someone else's.
          if (!window.confirm('Delete this version of the intro video?')) return;
          pickedId.value = null;
          deleteOp(shown.id);
          capture('intro_video_deleted');
        }}
      >
        Delete this version
      </Menu.Item>
    </IntroMenu>
  );
}

function IntroComposer() {
  const video = useVideoNote({ upload: uploadVideo });
  const title = useSignal('');
  const status = video.status.value;
  const id = video.id.value;
  // Closing the panel ends the take (the recorder releases the device on unmount), so it ends the composer too.
  useEffect(
    () => () => {
      introComposerOpen.value = false;
    },
    [],
  );
  const close = () => {
    video.clear();
    introComposerOpen.value = false;
  };
  const save = (e: SubmitEvent) => {
    e.preventDefault();
    if (!id) return;
    pushOp({
      id: nanoid(),
      tool: 'intro',
      video: id,
      title: title.value.trim() || undefined,
      color: color.value,
      lineWidth: lineWidth.value,
      ts: Date.now(),
      ...signedBy(),
    });
    capture('intro_video_posted', { version: intros.value.length });
    pickedId.value = null;
    introComposerOpen.value = false;
  };
  const idle = !id && status !== 'recording' && status !== 'working';

  return (
    <form onSubmit={save} class="p-3 border-b border-(--ds-gray-alpha-400)">
      <p class="m-0 text-ui font-semibold text-(--ds-gray-1000)">Intro video</p>
      <p class="m-0 mt-0.5 text-meta text-(--ds-gray-900) leading-snug">
        Pinned above the comments, so reviewers hear what you need before they start.
      </p>
      <VideoLive video={video} />
      <VideoDraft video={video} resolveUrl={fileUrl} />
      {id && (
        <div class={cn(geist.field, 'mt-2 flex items-center px-2')}>
          <input
            type="text"
            maxLength={120}
            placeholder="Title (optional)"
            aria-label="Intro title"
            value={title.value}
            onInput={(e) => (title.value = e.currentTarget.value)}
            class={cn(geist.input, 'w-full h-full')}
          />
        </div>
      )}
      <div class="mt-2 flex items-center gap-1.5">
        {idle && <VideoButton video={video} label />}
        <button type="button" onClick={close} class={cn(secondaryBtn, 'ml-auto h-7 px-2.5')}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!id}
          class={cn(
            submitBtn,
            'h-7 px-2.5',
            'disabled:pointer-events-none disabled:bg-(--ds-gray-alpha-200) disabled:text-(--ds-gray-700)',
          )}
        >
          Pin video
        </button>
      </div>
    </form>
  );
}

/** Mounted above the panel's list/detail switch, so opening a thread mid-take does not discard the recording. */
export function IntroComposerSlot() {
  return composing.value ? <IntroComposer /> : null;
}

/** The room's pinned walkthrough at the head of the annotation list, with its version history. */
export function IntroVideo() {
  if (composing.value) return null;
  const list = intros.value;
  const latest = list.at(-1);
  if (!latest) return null;
  const shown = list.find((op) => op.id === pickedId.value) ?? latest;
  return (
    <section aria-label="Intro video" class="p-3 border-b border-(--ds-gray-alpha-400)">
      <VideoPlayer key={shown.id} id={shown.video} resolveUrl={fileUrl} />
      <div class="mt-2 flex items-center gap-1">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-ui font-semibold text-(--ds-gray-1000) truncate">{shown.title || 'Intro'}</p>
          <p class="m-0 text-meta text-(--ds-gray-900) truncate">
            {shown.author || 'Anonymous'} · {timeAgo(shown.ts)}
          </p>
        </div>
        {list.length > 1 && <VersionMenu list={list} shown={shown} />}
        {!isReadonly.value && <IntroActions shown={shown} />}
      </div>
    </section>
  );
}
