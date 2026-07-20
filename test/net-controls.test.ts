import { describe, expect, it } from 'vitest';
import {
  MAX_CONNECTING_PEERS,
  MAX_PEX_DIALS,
  selectPexDialCandidates,
} from '../client/src/net/admission';
import { ReliableOutbox } from '../client/src/net/reliable-outbox';
import {
  canResolveCollisionLocally,
  collisionAuthority,
  isAuthorizedCollision,
} from '../client/src/sim/collision-authority';

describe('network resource controls', () => {
  it('limits new peers accepted from one PEX message', () => {
    const self = '0'.repeat(64);
    const ids = Array.from({ length: 32 }, (_, i) =>
      i.toString(16).padStart(64, '0'),
    );
    const selected = selectPexDialCandidates(ids, self, new Set(), 1, 0, 32);
    expect(selected.size).toBe(MAX_PEX_DIALS);
    expect(selected.has(self)).toBe(false);
  });

  it('reserves capacity when enough peer negotiations are already running', () => {
    const selected = selectPexDialCandidates(
      ['1'.repeat(64)],
      '0'.repeat(64),
      new Set(),
      10,
      MAX_CONNECTING_PEERS,
      32,
    );
    expect(selected.size).toBe(0);
  });

  it('bounds reliable pre-open messages and drains them in order', () => {
    const outbox = new ReliableOutbox();
    for (let i = 0; i < 70; i++) outbox.enqueue(String(i));
    expect(outbox.size).toBe(64);
    expect(outbox.dropped).toBe(6);
    const sent: string[] = [];
    outbox.drain((data) => sent.push(data));
    expect(sent[0]).toBe('0');
    expect(sent.at(-1)).toBe('63');
    expect(outbox.size).toBe(0);
  });

  it('coalesces replaceable presence data while reliable is opening', () => {
    const outbox = new ReliableOutbox();
    outbox.enqueue('old-pex', 'pex');
    outbox.enqueue('chat');
    outbox.enqueue('new-pex', 'pex');
    const sent: string[] = [];
    outbox.drain((data) => sent.push(data));
    expect(sent).toEqual(['new-pex', 'chat']);
  });

  it('selects and verifies one deterministic collision authority', () => {
    const player = 'a'.repeat(64);
    const npcOwner = 'b'.repeat(64);
    const npc = `${npcOwner}:npc:0`;
    expect(collisionAuthority(player, npc)).toBe(player);
    const event = {
      id: 'c',
      a: { f: 'a', i: 0, o: player },
      b: { f: 'b', i: 0, o: npc },
      da: 1,
      db: 1,
    };
    expect(isAuthorizedCollision(player, event)).toBe(true);
    expect(isAuthorizedCollision(npcOwner, event)).toBe(false);
  });

  it('waits for an unknown remote collision authority version', () => {
    const self = 'b'.repeat(64);
    const authority = 'a'.repeat(64);
    expect(canResolveCollisionLocally(self, authority, undefined, 6)).toBe(false);
    expect(canResolveCollisionLocally(self, authority, 5, 6)).toBe(true);
    expect(canResolveCollisionLocally(self, authority, 6, 6)).toBe(false);
    expect(canResolveCollisionLocally(authority, authority, undefined, 6)).toBe(true);
  });
});
