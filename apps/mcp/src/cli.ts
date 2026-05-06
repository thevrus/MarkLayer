#!/usr/bin/env node
import { startServer } from './server.js';

interface Args {
  apiBase: string;
  room: string | null;
  agentId: string;
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
  --help, -h           Show this help.

Environment:
  MARKLAYER_ROOM       Same as --room.
  MARKLAYER_API_BASE   Same as --api-base.
  MARKLAYER_AGENT      Same as --agent.
`;

function parseArgs(argv: string[]): Args {
  const out: Args = {
    apiBase: process.env.MARKLAYER_API_BASE ?? 'https://marklayer.app',
    room: process.env.MARKLAYER_ROOM ?? null,
    agentId: process.env.MARKLAYER_AGENT ?? 'claude-code',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--room' && argv[i + 1]) out.room = argv[++i] ?? null;
    else if (a === '--api-base' && argv[i + 1]) out.apiBase = argv[++i] ?? out.apiBase;
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
  });
}

main().catch((err) => {
  console.error('marklayer-mcp: fatal error:', err);
  process.exit(1);
});
