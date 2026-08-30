import { describe, expect, test } from 'bun:test';
import { stripPort53 } from './ice';

describe('stripPort53', () => {
  test('a single string url containing :53 yields null', () => {
    expect(stripPort53({ urls: 'turn:turn.example.com:53?transport=udp' })).toBeNull();
  });

  test('an array of urls that are entirely :53 yields null, not an object with an empty urls array', () => {
    const result = stripPort53({
      urls: ['turn:turn.example.com:53?transport=udp', 'turn:turn.example.com:53?transport=tcp'],
    });
    expect(result).toBeNull();
  });

  test('a mixed array keeps only the non-:53 entries and preserves the other fields', () => {
    const result = stripPort53({
      urls: ['turn:turn.example.com:53?transport=udp', 'turn:turn.example.com:3478?transport=udp'],
      username: 'user1',
      credential: 'secret1',
    });
    expect(result).toEqual({
      urls: ['turn:turn.example.com:3478?transport=udp'],
      username: 'user1',
      credential: 'secret1',
    });
  });

  test('a server with no :53 at all comes back with its urls intact', () => {
    const result = stripPort53({
      urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:443?transport=tcp'],
    });
    expect(result).toEqual({
      urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:443?transport=tcp'],
    });
  });

  // The regression this anchoring exists for: `includes(':53')` matched :5349 too,
  // dropping the TLS relay from every room while the log still looked healthy.
  test('keeps the TURNS relay on :5349, which only a substring match would eat', () => {
    const result = stripPort53({ urls: ['turns:turn.example.com:5349?transport=tcp'] });
    expect(result).toEqual({ urls: ['turns:turn.example.com:5349?transport=tcp'] });
  });

  test('strips :53 but keeps every other candidate in a real Cloudflare response', () => {
    const result = stripPort53({
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u',
      credential: 'c',
    });
    expect(result).toEqual({
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u',
      credential: 'c',
    });
  });

  test('a bare :53 with no query string is still stripped', () => {
    expect(stripPort53({ urls: 'turn:turn.example.com:53' })).toBeNull();
  });

  test('a single-string urls with no :53 is normalized into an array on the way out', () => {
    // The function always filters through an array, so even a lone string that
    // survives comes back wrapped in a one-element array, not as a bare string.
    const result = stripPort53({ urls: 'stun:stun.l.google.com:19302' });
    expect(result).toEqual({ urls: ['stun:stun.l.google.com:19302'] });
  });
});
