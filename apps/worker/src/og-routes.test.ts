import { describe, expect, test } from 'bun:test';
import { ogRoutes } from './og-routes';
import { nowInSeconds } from './store';
import { insertRow, migratedSqlite, SqliteD1 } from './test-d1';
import { FakeBucket, FakeExecutionContext, fakeEnv } from './test-env';

const ROOM = 'dsWPMrdw6EZ8jkkhxvFKS';
const PAGE = 'xxWPMrdw6EZ8jkkhxvFKS';
const PROJECT = 'prWPMrdw6EZ8jkkhxvFKS';

const NO_CARD = new FakeBucket({ get: async () => null });
const refused: RateLimit = { limit: async () => ({ success: false }) };

function card({ id, sqlite, limiter }: { id: string; sqlite: ReturnType<typeof migratedSqlite>; limiter?: RateLimit }) {
  const env = fakeEnv({ DB: new SqliteD1(sqlite), OG_BUCKET: NO_CARD, FETCH_LIMITER: limiter });
  return ogRoutes.request(`/og/${id}.png`, {}, env, new FakeExecutionContext());
}

const expectGeneric = (res: Response) => {
  expect(res.status).toBe(302);
  expect(res.headers.get('Location')).toBe('/og.jpg');
};

describe('/og/:key', () => {
  test('an invented id gets the generic card: nothing rendered, nothing stored', async () => {
    expectGeneric(await card({ id: ROOM, sqlite: migratedSqlite() }));
  });

  test('a render counts against the limiter', async () => {
    const sqlite = migratedSqlite();
    insertRow({ sqlite, table: 'annotations', row: { id: ROOM, ops: '[]' } });
    expect((await card({ id: ROOM, sqlite, limiter: refused })).status).toBe(429);
  });

  test('an expired room says nothing about itself', async () => {
    const sqlite = migratedSqlite();
    insertRow({ sqlite, table: 'annotations', row: { id: ROOM, ops: '[]', expires_at: nowInSeconds() - 60 } });
    expectGeneric(await card({ id: ROOM, sqlite }));
  });

  test('a project is judged by every page, not its first', async () => {
    const sqlite = migratedSqlite();
    insertRow({ sqlite, table: 'annotations', row: { id: ROOM, ops: '[]' } });
    insertRow({ sqlite, table: 'annotations', row: { id: PAGE, ops: '[]', password_hash: 'x' } });
    const pages = JSON.stringify([ROOM, PAGE]);
    insertRow({ sqlite, table: 'projects', row: { id: PROJECT, page_ids: pages, created_at: 1 } });
    expectGeneric(await card({ id: PROJECT, sqlite }));
  });
});
