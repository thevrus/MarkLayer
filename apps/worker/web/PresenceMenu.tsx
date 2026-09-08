import { Popover } from '@base-ui/react/popover';
import { Avatar } from '@ext/components/Avatar';
import { AgentMark } from '@ext/lib/agents';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { portalContainer } from '@ext/lib/portal';
import { type DepartedPeer, departedPeers, localUser, peers } from '@ext/lib/state';
import type { Peer } from '@ext/lib/types';
import { agentLabel, cn, isAgentPeer } from '@marklayer/types';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { PresenceDot } from './shared';
import { timeAgo } from './signals';

/** `lastSeen` is milliseconds; `timeAgo` counts in seconds. */
const since = (ms: number) => timeAgo(Math.floor(ms / 1000));

/**
 * What one peer is doing, in the terms that peer's data can actually support.
 *
 * An agent never sends a cursor, so its `lastSeen` only ever records the moment
 * it joined — reading that back as "idle 40 minutes" would be a lie about a
 * process that is connected and working. Presence in the list is the whole
 * signal there; for people, a live cursor is.
 */
function status(peer: Peer): string {
  if (isAgentPeer(peer.id)) return 'connected';
  return peer.cursor ? 'active now' : since(peer.lastSeen);
}

function Row({
  name,
  label,
  color,
  agent,
  detail,
  dim,
}: {
  /** Identity only — feeds the avatar's initials, so it must stay a bare name. */
  name: string;
  /** What the row displays, if it differs from `name` (e.g. "Vadym (you)"). */
  label?: ComponentChildren;
  color: string;
  agent?: boolean;
  detail: string;
  dim?: boolean;
}) {
  const shown = label ?? (agent ? agentLabel(name) : name);
  return (
    <div class="flex items-center gap-2.5 px-3.5 py-1.5">
      <Avatar
        name={name}
        color={color}
        size="md"
        dim={dim}
        glyph={agent ? <AgentMark id={name} size={11} /> : undefined}
      />
      <span
        class={cn(
          'text-ui tracking-ui min-w-0 flex-1 truncate font-medium',
          dim ? 'text-(--ds-gray-900)' : 'text-(--ds-gray-1000)',
        )}
      >
        {shown}
      </span>
      {/* Right-aligned so every row's status shares one edge however long the name is. */}
      <span class={cn(geist.meta, 'text-meta shrink-0 tabular-nums whitespace-nowrap')}>{detail}</span>
    </div>
  );
}

/**
 * Who is in the room, and who just was. Hangs off the "N online" readout, which
 * counts people but never said which — the question it obviously raises.
 */
export function PresenceMenu({ live, count }: { live: boolean; count: number }) {
  const [open, setOpen] = useState(false);
  const here = [...peers.value.values()];
  const gone = departedPeers.value;

  // Offline, or alone with nobody having left yet: the panel would list only
  // you. A control that opens to tell you what the label already said is worse
  // than no control, so the readout stays plain text until there is more.
  if (!live || (here.length === 0 && gone.length === 0)) {
    return (
      <div class="flex h-8 shrink-0 items-center gap-2 px-1.5">
        <PresenceDot live={live} />
        <span class={cn(geist.meta, 'text-meta font-medium tabular-nums whitespace-nowrap')}>
          {live ? `${count} online` : 'offline'}
        </span>
      </div>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Who is in this room"
        className={cn(
          'flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-1.5',
          'outline-none transition-colors duration-150 ease-out hover:bg-(--ds-gray-alpha-100)',
          'data-popup-open:bg-(--ds-gray-alpha-100)',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--ds-focus-color)',
        )}
      >
        <PresenceDot live={live} />
        <span class={cn(geist.meta, 'text-meta font-medium tabular-nums whitespace-nowrap')}>{count} online</span>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer.value ?? undefined}>
        <Popover.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-2147483647 outline-none"
        >
          <Popover.Popup className={cn(geist.surface, glass.font, 'w-64 overflow-hidden py-1.5 outline-none')}>
            <Row
              name={localUser.name}
              color={localUser.color}
              detail="active now"
              label={
                <>
                  {localUser.name} <span class="font-normal text-(--ds-gray-800)">(you)</span>
                </>
              }
            />
            {here.map((peer) => (
              <Row
                key={peer.id}
                name={peer.name}
                color={peer.color}
                agent={isAgentPeer(peer.id)}
                detail={status(peer)}
              />
            ))}
            {gone.length > 0 && (
              <>
                <div class={cn(geist.divider, 'my-1.5')} />
                <div class={cn(geist.sectionLabel, 'px-3.5 pb-1')}>Recently left</div>
                {gone.map((peer: DepartedPeer) => (
                  <Row
                    key={peer.id}
                    name={peer.name}
                    color={peer.color}
                    agent={isAgentPeer(peer.id)}
                    detail={`left ${since(peer.leftAt)}`}
                    dim
                  />
                ))}
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
