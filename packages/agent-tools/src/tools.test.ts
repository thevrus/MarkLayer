import { describe, expect, test } from 'bun:test';
import mcpPackage from '../../../apps/mcp/package.json' with { type: 'json' };
import { previewCreatedSchema } from './room-core';
import { MCP_SERVER_CARD, MCP_SERVER_VERSION } from './server-card';
import { flagOn, instructionsFor, TOOLS, toolsFor, WRITE_TOOLS } from './tools';

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
});

describe('read-only', () => {
  test('a read-only flag fails closed: anything but an explicit off turns it on', () => {
    for (const on of ['1', 'true', 'yes', 'TRUE ', 'please']) expect(flagOn(on)).toBe(true);
    for (const off of ['0', 'false', 'no', 'OFF', null, undefined]) expect(flagOn(off)).toBe(false);
  });

  test('every tool a read-only session refuses tells the client it writes', () => {
    const writes = TOOLS.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name);
    expect(writes).toEqual(expect.arrayContaining([...WRITE_TOOLS]));
    expect(WRITE_TOOLS.has('marklayer_watch_annotations')).toBe(false);
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
    expect(instructionsFor({ transport: 'stdio', readOnly: null })).toContain('marklayer_connect_room');
    expect(instructionsFor({ transport: 'http', readOnly: null })).not.toContain('marklayer_connect_room');
  });

  test('a preview answer parses', () => {
    const created = { id: 'r1', url: 'https://marklayer.app/s/r1', version: 1, previous: null };
    expect(previewCreatedSchema.safeParse(created).success).toBe(true);
  });
});
