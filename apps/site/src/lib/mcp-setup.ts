import { MCP_INSTALL } from '@marklayer/agent-tools';
import { ORIGIN } from '@marklayer/brand';

/**
 * The MCP setup, one snippet per client. `/mcp` renders these as the install
 * switcher and `/mcp.md` prints them for an agent to read, so a command edited
 * in one place cannot go stale in the other.
 */

/** The per-link endpoint, with the id left for the reader to fill. */
export const ROOM_MCP_URL = `${ORIGIN}/s/<id>/mcp`;

export type McpClient = {
  id: string;
  label: string;
  lang: 'bash' | 'json' | 'plaintext';
  /** Where the snippet goes, when it is a file rather than a command. */
  file?: string;
  code: string;
  /** The one thing to do after pasting it. */
  after: string;
};

export const MCP_CLIENTS: McpClient[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    lang: 'bash',
    code: `claude mcp add --transport http \\\n  marklayer ${ROOM_MCP_URL}`,
    after:
      'Run /mcp and check marklayer is listed. A session opened before this will not see the tools; start a new one.',
  },
  {
    id: 'claude',
    label: 'Claude',
    lang: 'plaintext',
    file: 'Settings → Connectors → Add custom connector',
    code: ROOM_MCP_URL,
    after:
      'Name it MarkLayer and paste the address. There is no sign-in to approve: the link is the credential. Start a new chat.',
  },
  {
    id: 'codex',
    label: 'Codex',
    lang: 'bash',
    code: `codex mcp add marklayer \\\n  --url ${ROOM_MCP_URL}?agent=codex`,
    after: 'If the current session does not list the tools, start a new one.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    lang: 'json',
    file: '~/.cursor/mcp.json',
    code: `{\n  "mcpServers": {\n    "marklayer": {\n      "url": "${ROOM_MCP_URL}?agent=cursor"\n    }\n  }\n}`,
    after: 'Keep any servers already in the file. Open a new chat so Cursor reloads its tool list.',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    lang: 'json',
    file: '.vscode/mcp.json',
    code: `{\n  "servers": {\n    "marklayer": {\n      "type": "http",\n      "url": "${ROOM_MCP_URL}?agent=copilot"\n    }\n  }\n}`,
    after: 'The top-level key is servers, not mcpServers, and the transport is named.',
  },
  {
    id: 'npm',
    label: 'Any client',
    lang: 'bash',
    code: MCP_INSTALL,
    after:
      'The same tools as a local stdio server, installed once for every link. Elsewhere, add a stdio entry running npx -y marklayer-mcp with MARKLAYER_AGENT set to the client’s name.',
  },
];

/** What to paste into CLAUDE.md or AGENTS.md so the agent reaches for MarkLayer on its own. */
export const MCP_HABIT = `## Visual review

When I share a marklayer.app/s/... link, connect to it over MCP and work the
annotations: acknowledge each one before you start, resolve it with a one-line
summary of what changed, and dismiss it with a reason if you cannot act on it.

When you have built something for me to look at, open a review room on the
preview URL with marklayer_share_preview and send me that link instead of
describing the change.`;

export const MCP_PROMPTS = {
  work: 'Watch my MarkLayer annotations. For each one, acknowledge it, make the fix, then resolve it with a one-line summary of what changed.',
  review:
    'Read the page in my MarkLayer room and review it for broken copy, accessibility gaps and layout bugs. Leave one comment per finding, and use a suggested edit for any exact text fix.',
};
