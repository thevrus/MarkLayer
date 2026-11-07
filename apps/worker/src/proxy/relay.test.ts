import { afterAll, describe, expect, test } from 'bun:test';
import { RELAY_HEADERS, RELAY_STATUS_OK } from '@marklayer/types/relay';
import { createRelayBreaker, relayFetch } from './relay';

/** Past the relay's header bound, which is the whole point: the wait is real because the trap is a real timer. */
const STREAM_MS = 6_300;

const server = Bun.serve({
  port: 0,
  idleTimeout: 30,
  fetch: () =>
    new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
          await Bun.sleep(STREAM_MS);
          controller.enqueue(new TextEncoder().encode('</html>'));
          controller.close();
        },
      }),
      { headers: { [RELAY_HEADERS.status]: RELAY_STATUS_OK } },
    ),
});
afterAll(() => server.stop(true));

describe('relayFetch', () => {
  test('a relayed page streaming past the header bound arrives whole', async () => {
    const resp = await relayFetch({
      url: 'https://blocked.example/',
      env: { FETCHER_URL: server.url.origin, FETCHER_TOKEN: 't' },
      breaker: createRelayBreaker(),
    });
    expect(await resp?.text()).toBe('<html></html>');
  }, 10_000);
});
