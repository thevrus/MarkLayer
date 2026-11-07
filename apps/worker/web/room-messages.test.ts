import { beforeEach, describe, expect, test } from 'bun:test';
import { toasts } from '@ext/lib/toasts';
import { viewerRoomMessages } from './room-messages';
import { followingPeer, onFollowScroll } from './ui-state';

const cursor = (peerId: string, y: number) => ({ type: 'cursor', peerId, x: 0, y }) as const;

describe('viewerRoomMessages', () => {
  beforeEach(() => {
    followingPeer.value = null;
    onFollowScroll.value = null;
    toasts.value = [];
  });

  test('a presenter pulls the room and says why; stopping or leaving lets go', () => {
    const onMessage = viewerRoomMessages();
    onMessage({ type: 'flock', peerId: 'p1', name: 'Ana', on: true });
    expect(followingPeer.value).toBe('p1');
    expect(toasts.value.map((t) => t.message)).toEqual(['Ana is presenting — scroll to break away']);

    onMessage({ type: 'flock', peerId: 'p2', name: 'Bo', on: false });
    expect(followingPeer.value).toBe('p1');

    onMessage({ type: 'peer_leave', peerId: 'p1' });
    expect(followingPeer.value).toBeNull();
  });

  test('follow scrolls to the followed cursor only, at most once per window', () => {
    const scrolled: number[] = [];
    onFollowScroll.value = (y) => scrolled.push(y);
    followingPeer.value = 'p1';
    const onMessage = viewerRoomMessages();

    onMessage(cursor('p2', 10));
    onMessage(cursor('p1', 20));
    onMessage(cursor('p1', 30));
    expect(scrolled).toEqual([20]);
  });
});
