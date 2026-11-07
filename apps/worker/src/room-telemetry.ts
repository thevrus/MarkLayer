import type { PeerInfo } from './peers';
import { captureServer } from './posthog';

type CaptureEnv = Parameters<typeof captureServer>[0];
type CaptureCtx = Parameters<typeof captureServer>[1];

/**
 * Aggregate telemetry for one room session, emitted once when the last peer
 * leaves. Counting in memory rather than per-op keeps this to a single event
 * per session instead of one per pen stroke — cheaper, and far less of a
 * surveillance surface. Hibernation resets these, which is fine: it is
 * best-effort product signal, not billing.
 */
export class SessionStats {
  private startedAt = 0;
  private ops = 0;
  /** tool → ops drawn with it this session. A set only ever said "used at all". */
  private tools = new Map<string, number>();
  private peakPeers = 0;
  private peakHumanPeers = 0;
  private hadAgent = false;
  /** Status, priority and assignee edits — the triage half, which draws no ops. */
  private updates = 0;

  noteOp(tool: string): void {
    this.ops++;
    this.tools.set(tool, (this.tools.get(tool) ?? 0) + 1);
  }

  noteUpdate(): void {
    this.updates++;
  }

  noteAgent(): void {
    this.hadAgent = true;
  }

  noteJoin({ peers, humans, agent }: { peers: number; humans: number; agent: boolean }): void {
    if (this.startedAt === 0) this.startedAt = Date.now();
    // An agent must not make a solo session read as collaborative.
    this.hadAgent ||= agent;
    this.peakPeers = Math.max(this.peakPeers, peers);
    this.peakHumanPeers = Math.max(this.peakHumanPeers, humans);
  }

  /**
   * One aggregate event per room session, fired as the last peer disconnects.
   * No room ID, no annotated URL, no peer names: `tools` is a sorted set of
   * tool names and the rest are counters. See src/posthog.ts for the wider contract.
   */
  async captureSession({ env, ctx }: { env: CaptureEnv; ctx: CaptureCtx }): Promise<void> {
    // An agent-only session draws nothing — it resolves and replies — so ops alone
    // would drop exactly the sessions the MCP bridge exists for.
    if (this.ops === 0 && this.updates === 0 && !this.hadAgent) return;
    // Heaviest first, and only the top few: the ranking has to stay inside the scrubber's 200-char cap.
    const byUse = [...this.tools].sort((a, b) => b[1] - a[1]).slice(0, 5);
    // Started before the counters are reset, awaited after — the reset is
    // synchronous, so the event carries the session it describes.
    const sent = captureServer(env, ctx, 'annotation_session_ended', {
      ops_total: this.ops,
      tools: [...this.tools.keys()].sort().join(','),
      tool_ops: byUse.map(([tool, n]) => `${tool}:${n}`).join(','),
      top_tool: byUse[0]?.[0] ?? null,
      tool_count: this.tools.size,
      peak_peers: this.peakPeers,
      peak_human_peers: this.peakHumanPeers,
      collaborative: this.peakHumanPeers > 1,
      agent_present: this.hadAgent,
      updates_total: this.updates,
      duration_ms: this.startedAt ? Date.now() - this.startedAt : 0,
    });
    this.ops = 0;
    this.tools.clear();
    this.peakPeers = 0;
    this.peakHumanPeers = 0;
    this.hadAgent = false;
    this.updates = 0;
    this.startedAt = 0;
    await sent;
  }
}

export function captureAgentJoined({
  env,
  ctx,
  humans,
  peers,
  opsWaiting,
}: {
  env: CaptureEnv;
  ctx: CaptureCtx;
  humans: number;
  peers: number;
  opsWaiting: number;
}): Promise<void> {
  return captureServer(env, ctx, 'agent_joined', {
    // Whether the agent is working alongside someone or on its own — the
    // difference between a live handoff and an unattended sweep.
    humans_present: humans,
    peers_present: peers,
    ops_waiting: opsWaiting,
  });
}

export function captureAgentLeft({
  env,
  ctx,
  info,
  humans,
}: {
  env: CaptureEnv;
  ctx: CaptureCtx;
  info: PeerInfo;
  humans: number;
}): Promise<void> {
  return captureServer(env, ctx, 'agent_left', {
    ops_total: info.ops ?? 0,
    updates_total: info.updates ?? 0,
    // How long the agent held the room. `watch` idles here; `resolve` does not.
    duration_ms: info.joinedAt ? Date.now() - info.joinedAt : 0,
    // Did anyone see it happen, or did it work an empty room?
    humans_present: humans,
  });
}
