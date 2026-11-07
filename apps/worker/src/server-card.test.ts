import { describe, expect, test } from 'bun:test';
import { MCP_SERVER_CARD, toolsFor } from '@marklayer/agent-tools';

describe('MCP server card', () => {
  // A hand-kept list that agent directories read; it sat at nine of twelve tools for a release.
  test('advertises exactly the tools the server answers', () => {
    expect([...MCP_SERVER_CARD.tools].sort()).toEqual(
      toolsFor('http')
        .map((t) => t.name)
        .sort(),
    );
  });
});
