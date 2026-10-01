import { describe, expect, test } from 'bun:test';
import { TOOLS } from '@marklayer/agent-tools';
import { MCP_SERVER_CARD } from '@site/lib/agent';

describe('MCP server card', () => {
  // A hand-kept list that agent directories read; it sat at nine of twelve tools for a release.
  test('advertises exactly the tools the server answers', () => {
    expect([...MCP_SERVER_CARD.tools].sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });
});
