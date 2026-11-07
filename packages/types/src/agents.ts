/**
 * The agents that connect to a room, with the name and colour to show for each.
 *
 * An MCP client announces itself as a bare id (`MARKLAYER_AGENT`, default
 * `claude-code`), which is what people saw: a lowercase slug in the presence
 * list and on every annotation the agent left. Colours are the brands' own.
 * Where a brand is black — Cursor, Copilot, Windsurf and Cline all publish
 * #000000 — it is lifted one step to #3F3F46, because these colours are also op
 * colours: a pin drawn in pure black disappears against dark page furniture, and
 * the value has to survive being handed straight to a canvas paint (which is why
 * none of these can be a CSS variable). An agent we do not know gets graphite,
 * never a stock violet: an unrecognised tool has no brand to borrow.
 */
const AGENT_BRAND_ROWS = {
  claude: { label: 'Claude', color: '#D97757' },
  gemini: { label: 'Gemini', color: '#8E75B2' },
  zed: { label: 'Zed', color: '#084CCF' },
  cursor: { label: 'Cursor', color: '#3F3F46' },
  copilot: { label: 'Copilot', color: '#3F3F46' },
  windsurf: { label: 'Windsurf', color: '#3F3F46' },
  cline: { label: 'Cline', color: '#3F3F46' },
  codex: { label: 'Codex', color: '#3F3F46' },
  openai: { label: 'OpenAI', color: '#3F3F46' },
  grok: { label: 'Grok', color: '#3F3F46' },
  aider: { label: 'Aider', color: '#6b7280' },
  devin: { label: 'Devin', color: '#6b7280' },
} as const satisfies Record<string, { label: string; color: string }>;

/** Looked up with an id off the wire, so a miss has to be a type the caller sees. */
const AGENT_BRANDS: Record<string, { label: string; color: string }> = AGENT_BRAND_ROWS;

/**
 * The ids agents announce themselves under that mean the same brand. Kept here
 * rather than in each table, because the brand's mark lives in the extension
 * (`lib/agents.tsx`) while its label and colour live above: spelling the
 * aliases out twice is how one gets an agent's icon without its name.
 */
const AGENT_ALIASES: Record<string, string> = {
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
  'github-copilot': 'copilot',
};

/** Fold an announced id onto the brand it belongs to. */
export const canonicalAgent = (id: string): string => {
  const lower = id.toLowerCase();
  return AGENT_ALIASES[lower] ?? lower;
};

/** What an unrecognised agent gets. Graphite, so nothing is claiming a brand it is not. */
export const AGENT_FALLBACK_COLOR = '#6b7280';

/** `claude-code` → `Claude`. An unknown id is title-cased rather than shown raw. */
export function agentLabel(id: string): string {
  const known = AGENT_BRANDS[canonicalAgent(id)];
  if (known) return known.label;
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const agentColor = (id: string): string => AGENT_BRANDS[canonicalAgent(id)]?.color ?? AGENT_FALLBACK_COLOR;

/** An annotation the agent wrote itself, not one it was handed — it stamps both fields only on its own. */
export const isAgentAuthored = (op: { author?: string; assignedAgent?: string }) =>
  !!op.assignedAgent && op.assignedAgent === op.author;

/** MCP agents connect as peers under this prefix (apps/mcp/src/room.ts). */
export const isAgentPeer = (peerId: string) => peerId.startsWith('mcp-');

/**
 * A peer id for one agent session: stable per `agentId`, distinct per session, so two
 * unnamed agents in a room stop collapsing into one presence entry.
 */
export const agentPeerId = ({ agentId, session }: { agentId: string; session: string }) => `mcp-${agentId}-${session}`;

/**
 * Who an agent is to a room, whichever transport carries it. `uid` is what the roster keys
 * a live peer on, so without it an @mention of a connected agent never matches `agentId`.
 */
export const agentPresence = ({ agentId, session }: { agentId: string; session: string }) => ({
  id: agentPeerId({ agentId, session }),
  uid: agentId,
  name: agentId,
  color: agentColor(agentId),
});
