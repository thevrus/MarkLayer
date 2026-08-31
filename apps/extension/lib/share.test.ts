import { describe, expect, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';
import {
  claudeMcpCommand,
  getAnnotationId,
  getRoomId,
  getShareUrl,
  HOW_IT_WORKS_PATH,
  HOW_IT_WORKS_URL,
  isLikelyEmbedHostile,
  isShareableUrl,
  loadAnnotations,
  npxMcpCommand,
  parseUrlHash,
  saveAnnotations,
  setAnnotationId,
} from './share';

describe('isShareableUrl', () => {
  test('accepts an ordinary public page over either web protocol', () => {
    expect(isShareableUrl('https://example.com/docs')).toBe(true);
    expect(isShareableUrl('http://example.com')).toBe(true);
  });

  test('rejects protocols the share viewer cannot fetch', () => {
    // The viewer refetches the page server-side, so anything not addressable
    // over HTTP resolves to an empty frame.
    expect(isShareableUrl('file:///Users/me/page.html')).toBe(false);
    expect(isShareableUrl('chrome-extension://abc/options.html')).toBe(false);
    expect(isShareableUrl('about:blank')).toBe(false);
    expect(isShareableUrl('data:text/html,<p>hi')).toBe(false);
  });

  test('rejects loopback in every spelling', () => {
    for (const host of ['localhost', '0.0.0.0', '127.0.0.1', '127.1.2.3', '[::1]']) {
      expect(isShareableUrl(`http://${host}:3000/app`)).toBe(false);
    }
  });

  test('rejects the local-network suffixes a dev machine advertises itself under', () => {
    expect(isShareableUrl('http://app.localhost:5173')).toBe(false);
    expect(isShareableUrl('http://macbook.local/dashboard')).toBe(false);
  });

  test('rejects an unparseable string instead of throwing at the call site', () => {
    expect(isShareableUrl('not a url')).toBe(false);
    expect(isShareableUrl('')).toBe(false);
  });
});

describe('isLikelyEmbedHostile', () => {
  test('flags the known frame-busting hosts', () => {
    expect(isLikelyEmbedHostile('https://youtube.com/watch?v=x')).toBe(true);
    expect(isLikelyEmbedHostile('https://x.com/someone')).toBe(true);
  });

  test('matches through a www prefix, a subdomain, and mixed case', () => {
    expect(isLikelyEmbedHostile('https://www.instagram.com/p/1')).toBe(true);
    expect(isLikelyEmbedHostile('https://m.facebook.com/x')).toBe(true);
    expect(isLikelyEmbedHostile('https://WWW.TikTok.com/@a')).toBe(true);
  });

  test('does not flag a host that merely ends with the same letters', () => {
    // A suffix check without the dot would condemn every "…x.com" domain.
    expect(isLikelyEmbedHostile('https://notx.com/page')).toBe(false);
    expect(isLikelyEmbedHostile('https://myyoutube.com')).toBe(false);
    expect(isLikelyEmbedHostile('https://example.com')).toBe(false);
  });

  test('treats an unparseable url as embeddable rather than throwing', () => {
    expect(isLikelyEmbedHostile('nonsense')).toBe(false);
  });
});

describe('MCP connect commands', () => {
  // Both surfaces offer these verbatim for copy-paste; a dropped flag or a room
  // id that never reaches the string hands the user a command that just fails.
  test('carry the room id and the non-interactive npx flag', () => {
    expect(claudeMcpCommand('room-42')).toBe('claude mcp add marklayer -- npx -y marklayer-mcp --room room-42');
    expect(npxMcpCommand('room-42')).toBe('npx -y marklayer-mcp --room room-42');
  });
});

describe('room identity', () => {
  test('reuses one id across share surfaces so collaborators land on one canvas', () => {
    const first = getRoomId();
    expect(getRoomId()).toBe(first);
    expect(getShareUrl()).toBe(`https://marklayer.app/s/${first}`);
  });

  test('adopting an existing id repoints the share url at it', () => {
    setAnnotationId('adopted-id');
    expect(getRoomId()).toBe('adopted-id');
    expect(getShareUrl()).toBe('https://marklayer.app/s/adopted-id');
  });
});

describe('parseUrlHash', () => {
  const withHash = (hash: string) => {
    window.location.hash = hash;
    return parseUrlHash();
  };

  test('reads the capture width and room id out of the ant hash', () => {
    expect(withHash('#ant=1440=abc123')).toEqual({ width: 1440, id: 'abc123' });
  });

  test('ignores a hash that is not ours, or no hash at all', () => {
    expect(withHash('#section-2')).toBeNull();
    expect(withHash('')).toBeNull();
  });

  test('rejects a width that would scale the capture to nothing', () => {
    // A zero or negative width divides through the reprojection maths.
    expect(withHash('#ant=0=abc')).toBeNull();
    expect(withHash('#ant=-100=abc')).toBeNull();
    expect(withHash('#ant=wide=abc')).toBeNull();
  });

  test('rejects a hash with a missing or extra segment', () => {
    expect(withHash('#ant=1440')).toBeNull();
    expect(withHash('#ant=1440=abc=extra')).toBeNull();
  });
});

describe('HOW_IT_WORKS links', () => {
  test('the absolute url is the app origin plus the path the landing page links to', () => {
    // The extension dialog and the web info panel are not guaranteed to be
    // running on marklayer.app, so they need the absolute form of the same page.
    expect(HOW_IT_WORKS_URL).toBe(`https://marklayer.app${HOW_IT_WORKS_PATH}`);
    expect(HOW_IT_WORKS_PATH.startsWith('/')).toBe(true);
  });
});

describe('getAnnotationId', () => {
  test('reports the current room without minting one', () => {
    setAnnotationId('known-room');
    expect(getAnnotationId()).toBe('known-room');
  });
});

describe('saveAnnotations and loadAnnotations', () => {
  /**
   * Swaps `fetch`, and captures the logging the failure paths do so the run stays
   * readable. Typed as the call signature rather than `typeof fetch`: Bun's fetch
   * carries a `preconnect` property that a stub has no reason to implement.
   */
  type FetchImpl = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  const withFetch = async (impl: FetchImpl, body: (logged: string[]) => Promise<void>) => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const logged: string[] = [];
    const swap = (key: 'fetch', value: unknown) =>
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    swap('fetch', impl);
    console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
    try {
      await body(logged);
    } finally {
      swap('fetch', originalFetch);
      console.error = originalError;
    }
  };

  const op: DrawOp = { id: 'op1', color: '#000', lineWidth: 2, tool: 'text', text: 'x', x: 0, y: 0, fontSize: 14 };

  test('posts the ops to the room, with the page url stripped of its hash', async () => {
    // The hash carries our own viewer state; storing it would make the saved
    // url a different page from the one annotated.
    window.location.hash = '#ant=1440=abc';
    setAnnotationId('room-1');
    // Collected into an array, not a nullable local: assigning inside the callback
    // leaves the checker convinced it is still null at the assertions below.
    const calls: { url: string; init: RequestInit | undefined }[] = [];

    await withFetch(
      async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response('{}', { status: 200 });
      },
      async () => {
        expect(await saveAnnotations([op])).toBe(true);
      },
    );

    expect(calls[0]?.url).toBe('https://marklayer.app/api/room-1');
    expect(calls[0]?.init?.method).toBe('POST');
    const sent: unknown = JSON.parse(String(calls[0]?.init?.body));
    expect(sent).toMatchObject({ ops: [op], url: 'https://example.com/page', width: window.innerWidth });
    window.location.hash = '';
  });

  test('reports a failed save rather than pretending it worked', async () => {
    await withFetch(
      async () => new Response('nope', { status: 500 }),
      async (logged) => {
        expect(await saveAnnotations([op])).toBe(false);
        expect(logged.join()).toContain('Error saving annotations');
      },
    );
  });

  test('reports a save that never reached the network', async () => {
    await withFetch(
      async () => {
        throw new Error('offline');
      },
      async (logged) => {
        expect(await saveAnnotations([op])).toBe(false);
        expect(logged.join()).toContain('Error saving annotations');
      },
    );
  });

  test('loads the ops for a room', async () => {
    await withFetch(
      async () => new Response(JSON.stringify([op]), { status: 200 }),
      async () => {
        expect(await loadAnnotations('room-1')).toEqual([op]);
      },
    );
  });

  test('returns null for a missing room, so a caller can tell it apart from an empty one', async () => {
    // An empty array is a real canvas with nothing on it; null is a failure.
    await withFetch(
      async () => new Response('not found', { status: 404 }),
      async (logged) => {
        expect(await loadAnnotations('gone')).toBeNull();
        expect(logged.join()).toContain('Error loading annotations');
      },
    );
  });

  test('returns null when the response is not the JSON it claims to be', async () => {
    await withFetch(
      async () => new Response('<html>error page</html>', { status: 200 }),
      async (logged) => {
        expect(await loadAnnotations('room-1')).toBeNull();
        expect(logged.join()).toContain('Error loading annotations');
      },
    );
  });
});
