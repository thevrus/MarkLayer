import { MCP_SERVER_VERSION } from '@marklayer/agent-tools';
import type { APIRoute } from 'astro';
import { AGENT_TOOL_GROUPS, AGENT_TOOLS } from '../lib/agent-tools';
import { MCP_CLIENTS, MCP_HABIT, MCP_PROMPTS, ROOM_MCP_URL } from '../lib/mcp-setup';

/**
 * The MCP setup as plain text, for an agent to read and act on. Prerendered to
 * `mcp.md`, which Workers serves at `/mcp.md`. Same source as `/mcp`, so the
 * commands cannot drift between the page a human reads and the one an agent does.
 */
const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\n\`\`\``;

const clients = MCP_CLIENTS.map(
  (c) => `## ${c.label}\n\n${c.file ? `${c.file}:\n\n` : ''}${fence(c.lang, c.code)}\n\n${c.after}`,
).join('\n\n');

const tools = AGENT_TOOL_GROUPS.map(
  (g) => `### ${g.group}\n\n${g.tools.map((t) => `- \`marklayer_${t.name}\`: ${t.does}`).join('\n')}`,
).join('\n\n');

const body = `# Connect MarkLayer to your coding agent

Every MarkLayer share link is a remote MCP server (Streamable HTTP) at the
link's own address plus \`/mcp\`:

    ${ROOM_MCP_URL}

Replace \`<id>\` with the id in the share link. No account, no API key: the
link is the credential. Add \`?agent=<name>\` so reviewers see which agent
picked up their comment; it defaults to "agent".

The same ${AGENT_TOOLS.length} tools ship on npm as \`marklayer-mcp\` (v${MCP_SERVER_VERSION}), a local
stdio server, for clients that cannot reach remote servers or want one install
that covers every link. Set \`MARKLAYER_AGENT\` to the client's name, and
\`MARKLAYER_PASSWORD\` for a password-protected link. Over HTTP a protected
link takes the password as a header instead: \`Authorization: Bearer <password>\`
(\`--header\` on \`claude mcp add\`).

Before adding a server, inspect the client's active MCP configuration. If a
"marklayer" entry already exists, correct it rather than adding a second one.

${clients}

## Verify

Seeing the server listed is not proof. Call \`marklayer_room_info\`; it answers
with the URL the link annotates. A 401 means the link is password protected:
send the bearer header above, or use the npm package with \`MARKLAYER_PASSWORD\`. If no MarkLayer tools are
listed, the session predates the configuration; start a new one.

## Tools

${tools}

## Working a review

${MCP_PROMPTS.work}

Loop: \`marklayer_list_annotations\` to backfill what is open, then
\`marklayer_watch_annotations\` repeatedly. For each annotation: acknowledge,
make the change, resolve with a one-line summary. Dismiss with a reason when
you cannot act. Use \`marklayer_suggest_edit\` for an exact text fix.

## Reviewing a page yourself

${MCP_PROMPTS.review}

## Remember this workflow

If you have access to the project's agent instructions (CLAUDE.md, AGENTS.md
or the equivalent), add:

${fence('markdown', MCP_HABIT)}
`;

export const GET: APIRoute = () => new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
