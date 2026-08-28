import { describe, expect, test } from 'bun:test';
import { isBlockedHost, isPrivateAddress, parseFetchableUrl, type UnfetchableReason } from './net';

describe('isPrivateAddress', () => {
  test.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:169.254.169.254', // v4-mapped metadata endpoint
  ])('%s is private', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  test.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '100.128.0.1', '2606:4700::1111', 'example.com'])(
    '%s is public',
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(false);
    },
  );
});

describe('isBlockedHost', () => {
  test.each(['localhost', 'metadata.google.internal', 'foo.internal', 'printer.local', '127.0.0.1', '[::1]'])(
    '%s is blocked',
    (host) => {
      expect(isBlockedHost(host)).toBe(true);
    },
  );

  test.each(['iot450.com', 'example.com', 'localhost.example.com'])('%s is allowed', (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });
});

describe('parseFetchableUrl', () => {
  test('accepts an ordinary https page', () => {
    const gate = parseFetchableUrl('https://iot450.com/about');
    expect(gate.ok && gate.url.host).toBe('iot450.com');
  });

  // The reason is load-bearing: the Worker phrases a different error for each,
  // and `classifyProxyError` matches on that prose.
  const rejected: [string, UnfetchableReason][] = [
    ['not a url', 'invalid'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked'],
  ];
  test.each(rejected)('rejects %s as %s', (raw, reason) => {
    expect(parseFetchableUrl(raw)).toEqual({ ok: false, reason });
  });
});
