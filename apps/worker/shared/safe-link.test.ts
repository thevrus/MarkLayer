import { describe, expect, test } from 'bun:test';
import { unwrapSafeLink } from './safe-link';

describe('unwrapSafeLink', () => {
  const target = 'https://staging.example.com/pricing?tab=2&ref=a b';
  const wrapped = (host: string) =>
    `https://${host}/?url=${encodeURIComponent(target)}&data=05%7C02%7Cx&sdata=abc%3D&reserved=0`;

  test.each([
    'gcc02.safelinks.protection.outlook.com',
    'nam12.safelinks.protection.outlook.com',
    'safelinks.protection.outlook.com',
  ])('unwraps %s to the real target, decoded', (host) => {
    expect(unwrapSafeLink(wrapped(host))).toBe(target);
  });

  test.each([
    'https://example.com/?url=https%3A%2F%2Fother.com',
    'https://evilsafelinks.protection.outlook.com/?url=https%3A%2F%2Fother.com',
    'https://safelinks.protection.outlook.com.evil.test/?url=https%3A%2F%2Fother.com',
    'https://gcc02.safelinks.protection.outlook.com/?data=x',
    'https://gcc02.safelinks.protection.outlook.com/?url=javascript%3Aalert(1)',
    'not a url',
  ])('leaves %s alone', (input) => {
    expect(unwrapSafeLink(input)).toBe(input);
  });
});
