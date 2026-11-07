import { ORIGIN } from '@marklayer/brand';

/**
 * The agent-facing well-known surface, in one place.
 *
 * These documents are served twice: from this static site (and its standalone
 * Pages deploy) and from the Worker, which claims the same paths via
 * `run_worker_first`. Both sides read this module and the sibling
 * `content/agent/*` files, so the Worker copy can never advertise a different
 * spec, tool list or digest than the site does.
 */

export const SKILL_PATH = '/.well-known/agent-skills/marklayer-annotations/SKILL.md';

const SKILL_DESCRIPTION =
  'Create MarkLayer annotation share links over a no-auth HTTP API, and process a human’s webpage annotations as a work queue over MCP, at the share link’s own /mcp address or via the marklayer-mcp package.';

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
