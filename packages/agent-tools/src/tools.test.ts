import { describe, expect, test } from 'bun:test';
import mcpPackage from '../../../apps/mcp/package.json' with { type: 'json' };
import { previewCreatedSchema } from './room-core';
import { MCP_SERVER_CARD, MCP_SERVER_VERSION } from './server-card';
import { instructionsFor, NEEDS_LIVE_ROOM, NEEDS_ROOM, TOOLS, toolsFor } from './tools';

test('a limit only the zod input states reaches the client', () => {
  const nextSteps = TOOLS.find((tool) => tool.name === 'marklayer_set_next_steps');
  expect(JSON.stringify(nextSteps?.inputSchema)).toContain('"maxLength":300');
});

describe('the tool table', () => {
  test('connect_room is served on stdio alone, since a URL binds the room over HTTP', () => {
    expect(toolsFor('stdio')).toHaveLength(TOOLS.length);
    expect(toolsFor('http').map((tool) => tool.name)).not.toContain('marklayer_connect_room');
    expect(toolsFor('http')).toHaveLength(TOOLS.length - 1);
  });

  test('advertises diagnose as a write and read_diagnosis as a read', () => {
    expect(TOOLS.find((tool) => tool.name === 'marklayer_diagnose')?.description).toContain('Call this when');
    expect(TOOLS.find((tool) => tool.name === 'marklayer_read_diagnosis')?.description).toContain('hit-test');
    expect(NEEDS_LIVE_ROOM.has('marklayer_diagnose')).toBe(true);
    expect(NEEDS_ROOM.has('marklayer_read_diagnosis')).toBe(true);
    expect(NEEDS_LIVE_ROOM.has('marklayer_read_diagnosis')).toBe(false);
  });
});

describe('what the servers announce', () => {
  test('the contract version is the published package version', () => {
    expect(MCP_SERVER_VERSION).toBe(mcpPackage.version);
  });

  test('the card lists what HTTP can call', () => {
    expect(MCP_SERVER_CARD.tools).toEqual(toolsFor('http').map((tool) => tool.name));
    expect(MCP_SERVER_CARD.remotes[0]?.url).toBe('https://marklayer.app/s/{room}/mcp');
  });

  test('a server never teaches a tool it does not serve', () => {
    expect(instructionsFor('stdio')).toContain('marklayer_connect_room');
    expect(instructionsFor('http')).not.toContain('marklayer_connect_room');
  });

  test('a preview answer parses', () => {
    const created = { id: 'r1', url: 'https://marklayer.app/s/r1', version: 1, previous: null };
    expect(previewCreatedSchema.safeParse(created).success).toBe(true);
  });
});
