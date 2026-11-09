import { describe, expect, test } from 'bun:test';
import { AGENT_FALLBACK_COLOR, agentBrand, agentColor, agentLabel } from './agents';

describe('agent branding', () => {
  test('an unrecognised id is title-cased and claims no brand', () => {
    expect(agentLabel('my-cool-agent')).toBe('My Cool Agent');
    expect(agentColor('my-cool-agent')).toBe(AGENT_FALLBACK_COLOR);
    expect(agentLabel('CLAUDE-CODE')).toBe('Claude');
  });
});

test('only a known brand survives agentBrand, so telemetry never carries a typed name', () => {
  expect(agentBrand('Claude-Code')).toBe('claude');
  expect(agentBrand('acme-internal-bot')).toBe('other');
});
