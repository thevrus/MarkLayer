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
    // IPv6 literals wrapping a private IPv4. WHATWG URL rewrites the dotted tail
    // to hex (`[::ffff:a9fe:a9fe]`), so the guard must judge the embedded bits.
    ['http://[::ffff:169.254.169.254]/', 'blocked'],
    ['http://[::ffff:127.0.0.1]/', 'blocked'],
    ['http://[::ffff:10.0.0.1]/', 'blocked'],
    ['http://[::ffff:192.168.1.1]/', 'blocked'],
    ['http://[::ffff:100.64.0.1]/', 'blocked'],
    ['http://[0:0:0:0:0:ffff:172.16.0.1]/', 'blocked'],
    ['http://[64:ff9b::a9fe:a9fe]/', 'blocked'], // NAT64 well-known prefix
    ['http://[64:ff9b::10.0.0.1]/', 'blocked'],
    ['http://[::127.0.0.1]/', 'blocked'], // IPv4-compatible (deprecated)
    ['http://[2002:a9fe:a9fe::]/', 'blocked'], // 6to4
    ['http://[2002:c0a8:101::1]/', 'blocked'],
  ];
  test.each(rejected)('rejects %s as %s', (raw, reason) => {
    expect(parseFetchableUrl(raw)).toEqual({ ok: false, reason });
  });

  test.each([
    'http://[2606:4700::1111]/',
    'http://[::ffff:8.8.8.8]/',
    'http://[64:ff9b::808:808]/',
    'http://[2002:808:808::1]/',
  ])('allows public IPv6 %s', (raw) => {
    expect(parseFetchableUrl(raw).ok).toBe(true);
  });
});
