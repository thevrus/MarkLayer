import { ORIGIN } from '@marklayer/brand';
import { mcpAddCommand, mcpEndpoint, sharePath } from '@marklayer/brand/links';
import { version } from '../package.json' with { type: 'json' };
import { toolsFor } from './tools';

/** What both servers announce. A literal here fell three releases behind once; keep this package's version on the npm package's. */
export const MCP_SERVER_VERSION: string = version;

/** The stdio install, roomless: the agent is handed a room later by link. */
export const MCP_INSTALL = 'claude mcp add marklayer -- npx -y marklayer-mcp';

const ROOM_VARIABLE = '{room}';

/**
 * MCP Server Card (SEP-1649). The stdio package is the one fixed address; the
 * Streamable-HTTP endpoint is per room, so it goes in the registry's `remotes` shape
 * with the room as a URL variable. It advertises what HTTP can call: a card is read
 * before anything connects, and `marklayer_connect_room` has no meaning there.
 */
export const MCP_SERVER_CARD = {
  serverInfo: { name: 'marklayer-mcp', version: MCP_SERVER_VERSION },
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'marklayer-mcp'],
    install: MCP_INSTALL,
    package: 'https://www.npmjs.com/package/marklayer-mcp',
  },
  remotes: [
    {
      type: 'streamable-http',
      url: mcpEndpoint({ roomId: ROOM_VARIABLE }),
      install: mcpAddCommand({ roomId: ROOM_VARIABLE }),
      variables: {
        room: {
          description: `The id in a share link (${ORIGIN}${sharePath(ROOM_VARIABLE)}). The endpoint serves that one room, so it has every tool but marklayer_connect_room.`,
          isRequired: true,
        },
      },
    },
  ],
  capabilities: { tools: true, resources: false, prompts: false },
  tools: toolsFor('http').map((tool) => tool.name),
  documentation: 'https://github.com/thevrus/MarkLayer/tree/main/apps/mcp',
};
