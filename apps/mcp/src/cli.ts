#!/usr/bin/env node
import { flagOn } from '@marklayer/agent-tools';
import { ORIGIN } from '@marklayer/brand';
import { startServer } from './server.js';

interface Args {
  apiBase: string;
  room: string | null;
  agentId: string;
  readOnly: boolean;
  help: boolean;
}

const HELP = `marklayer-mcp — bridge MarkLayer annotations to AI coding agents over MCP.

Usage:
  marklayer-mcp [options]

Options:
  --room <url-or-id>   Connect to a specific MarkLayer room at startup. Accepts
                       a full share URL (https://marklayer.app/s/abc123) or a
                       bare id. Otherwise the agent must call marklayer_connect_room.
  --api-base <url>     Override the MarkLayer worker base URL (default https://marklayer.app).
                       Useful when running against a local dev worker.
  --agent <name>       Identifier shown to humans for this agent. Default: "claude-code".
  --readonly           Read and watch only: every tool that changes the room is refused,
                       even on a link that allows edits.
  --help, -h           Show this help.

Environment:
  MARKLAYER_ROOM       Same as --room.
  MARKLAYER_API_BASE   Same as --api-base.
  MARKLAYER_AGENT      Same as --agent.
  MARKLAYER_READONLY   Set to 1 for the same as --readonly.
  MARKLAYER_PASSWORD   Password for a protected room. Environment only, never a
                       flag, so it stays out of the process list. The
                       marklayer_connect_room tool also takes a password.
`;

function parseArgs(argv: string[]): Args {
  const out: Args = {
    apiBase: process.env.MARKLAYER_API_BASE ?? ORIGIN,
    room: process.env.MARKLAYER_ROOM ?? null,
    agentId: process.env.MARKLAYER_AGENT ?? 'claude-code',
    readOnly: flagOn(process.env.MARKLAYER_READONLY),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--room' && argv[i + 1]) out.room = argv[++i] ?? null;
    else if (a === '--api-base' && argv[i + 1]) out.apiBase = argv[++i] ?? out.apiBase;
    else if (a === '--readonly') out.readOnly = true;
    else if (a === '--agent' && argv[i + 1]) out.agentId = argv[++i] ?? out.agentId;
    else if (a?.startsWith('--')) {
      console.error(`marklayer-mcp: unknown option ${a}`);
      process.exit(2);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  await startServer({
    apiBase: args.apiBase,
    initialRoom: args.room,
    agentId: args.agentId,
    password: process.env.MARKLAYER_PASSWORD || null,
    readOnly: args.readOnly,
  });
}

main().catch((err) => {
  console.error('marklayer-mcp: fatal error:', err);
  process.exit(1);
});
