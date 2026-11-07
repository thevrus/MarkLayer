import { describe, expect, test } from 'bun:test';
import { redactSharePath } from './demo-room';

describe('redactSharePath', () => {
  test.each([
    ['/s/abc123XYZ', '/s/:id'],
    ['/s/abc123XYZ/mcp', '/s/:id/mcp'],
    ['/s/abc123XYZ?x=1', '/s/:id?x=1'],
  ])('hides the room id in %s', (input, expected) => {
    expect(redactSharePath(input)).toBe(expected);
  });

  test.each([
    '/',
    '/vs/markup-io',
    '/p/projectid',
    '/s/marklayer-live-demo-board',
    '/guides/s/abc',
    'https://x.test/s/abc',
  ])('leaves %s alone', (input) => {
    expect(redactSharePath(input)).toBe(input);
  });
});
