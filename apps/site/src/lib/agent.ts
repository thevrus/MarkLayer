import mcpPkg from '../../../mcp/package.json';
import { ORIGIN } from './site';

/**
 * The agent-facing well-known surface, in one place.
 *
 * These documents are served twice: from this static site (and its standalone
 * Pages deploy) and from the Worker, which claims the same paths via
 * `run_worker_first`. Both sides read this module and the sibling
 * `content/agent/*` files, so the Worker copy can never advertise a different
 * spec, tool list or digest than the site does.
 */

/** Read from apps/mcp/package.json at build time so a release can't leave the server card advertising a stale version. */
export const MCP_VERSION: string = mcpPkg.version;

export const SKILL_PATH = '/.well-known/agent-skills/marklayer-annotations/SKILL.md';

const SKILL_DESCRIPTION =
  'Create MarkLayer annotation share links over a no-auth HTTP API, and process a human’s webpage annotations as a work queue via the marklayer-mcp server.';

/** RFC 9727 API catalog: points agents at the share API's spec, docs and health check. */
export const API_CATALOG = {
  linkset: [
    {
      anchor: `${ORIGIN}/api`,
      'service-desc': [{ href: `${ORIGIN}/api/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1.0' }],
      'service-doc': [{ href: `${ORIGIN}/llms-full.txt`, type: 'text/markdown' }],
      status: [{ href: `${ORIGIN}/api/health` }],
    },
  ],
};

/**
 * MCP Server Card (SEP-1649). MarkLayer's MCP server ships as a stdio process
 * over npm (marklayer-mcp), not a hosted HTTP endpoint, so the stdio transport
 * is described honestly rather than advertising a Streamable-HTTP URL that does
 * not exist. The tool list mirrors apps/mcp/src/server.ts.
 */
export const MCP_SERVER_CARD = {
  serverInfo: { name: 'marklayer-mcp', version: MCP_VERSION },
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'marklayer-mcp'],
    install: 'claude mcp add marklayer -- npx -y marklayer-mcp',
    package: 'https://www.npmjs.com/package/marklayer-mcp',
  },
  capabilities: { tools: true, resources: false, prompts: false },
  tools: [
    'marklayer_connect_room',
    'marklayer_room_info',
    'marklayer_list_annotations',
    'marklayer_get_annotation',
    'marklayer_watch_annotations',
    'marklayer_acknowledge',
    'marklayer_resolve',
    'marklayer_dismiss',
    'marklayer_reply',
  ],
  documentation: 'https://github.com/thevrus/MarkLayer/tree/main/apps/mcp',
};

/**
 * Agent Skills Discovery RFC v0.2.0 index. The digest is always derived from
 * the same SKILL.md bytes the caller serves, so editing the skill text can
 * never leave the index advertising a stale hash.
 */
export function skillIndex(digest: string) {
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [
      {
        name: 'marklayer-annotations',
        type: 'skill-md',
        description: SKILL_DESCRIPTION,
        url: `${ORIGIN}${SKILL_PATH}`,
        digest,
      },
    ],
  };
}
