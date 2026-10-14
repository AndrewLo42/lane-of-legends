import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Socket } from '../../server/room';
import { STARTER_ITEMS } from '../sim/items';
import { RELIC_SECONDS, SEAT_GRACE, type ServerMsg } from './protocol';

/** A player's end of the connection: everything the room sent, parsed. */
class FakeSocket implements Socket {
  got: ServerMsg[] = [];
  closed = false;
  send(data: string) {
    this.got.push(JSON.parse(data) as ServerMsg);
  }
  close() {
    this.closed = true;
  }
  last<T extends ServerMsg['t']>(t: T) {
    return this.got.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t).at(-1);
  }
}

function duel() {
  const emptied = vi.fn();
  const room = new Room('ABCD', emptied);
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.add(a);
  room.add(b);
  room.message(a, JSON.stringify({ t: 'ready', ready: true }));
  room.message(b, JSON.stringify({ t: 'ready', ready: true }));
  return { room, a, b, emptied, seat: a.last('seat')!.token };
}

describe('reconnecting to a duel', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('pauses the duel while a player is away and picks it up again when they come back with their seat', () => {
    const { room, a, b, seat } = duel();
    expect(a.last('start')).toBeTruthy();
    vi.advanceTimersByTime(1000);
    const before = b.last('snap')!.snap.tick;
    expect(before).toBeGreaterThan(20);

    room.leave(a);
    expect(b.last('peer')).toMatchObject({ connected: false, wait: SEAT_GRACE });
    vi.advanceTimersByTime(5000);
    expect(b.last('snap')!.snap.tick).toBeLessThanOrEqual(before + 1); // paused
    expect(b.last('peer')!.wait).toBeLessThan(SEAT_GRACE); // counting down, about once a second

    const back = new FakeSocket();
    room.rejoin(back, seat);
    const resume = back.last('resume')!;
    expect(resume.you).toBe(a.last('start')!.you);
    expect(resume.snap.tick).toBe(b.last('snap')!.snap.tick);
    expect(b.last('peer')).toMatchObject({ connected: true });
    vi.advanceTimersByTime(1000);
    expect(back.last('snap')!.snap.tick).toBeGreaterThan(resume.snap.tick + 20); // running again, to the new connection
  });

  it('turns away a wrong seat token', () => {
    const { room, a } = duel();
    room.leave(a);
    const intruder = new FakeSocket();
    room.rejoin(intruder, 'not-a-seat');
    expect(intruder.last('error')).toBeTruthy();
    expect(intruder.closed).toBe(true);
  });

  it('is a forfeit once the held seat runs out, and the room empties when the other player goes too', () => {
    const { room, a, b, seat, emptied } = duel();
    room.leave(a);
    vi.advanceTimersByTime(SEAT_GRACE * 1000 + 100);
    expect(b.last('end')).toMatchObject({ left: true, winner: 'red' });
    expect(b.last('lobby')!.players).toHaveLength(1);
    const late = new FakeSocket();
    room.rejoin(late, seat);
    expect(late.last('error')).toBeTruthy();
    room.leave(b);
    expect(emptied).toHaveBeenCalled();
  });
});

describe('relics in online duels', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  function relicRoom() {
    const room = new Room('ABCD');
    const a = new FakeSocket();
    const b = new FakeSocket();
    room.add(a);
    room.add(b);
    room.message(a, JSON.stringify({ t: 'relics', on: true }));
    room.message(a, JSON.stringify({ t: 'ready', ready: true }));
    room.message(b, JSON.stringify({ t: 'ready', ready: true }));
    return { room, a, b };
  }
  /** The relic each champion carries, from the duel's first snapshot. */
  const carried = (s: FakeSocket) => s.last('start')!.snap.units.filter((u) => u.champ).map((u) => u.champ!.items);

  it('offers each player three relics once both are ready, and starts the duel with the ones they chose', () => {
    const { room, a, b } = relicRoom();
    expect(a.last('lobby')).toMatchObject({ relics: true, picking: true });
    const offerA = a.last('relicOffer')!.offer;
    const offerB = b.last('relicOffer')!.offer;
    expect(offerA).toHaveLength(3);
    expect(offerA.every((id) => STARTER_ITEMS.includes(id))).toBe(true);
    expect(a.last('start')).toBeUndefined();

    room.message(a, JSON.stringify({ t: 'relic', id: 'not-offered' })); // ignored
    room.message(a, JSON.stringify({ t: 'relic', id: offerA[1] }));
    expect(b.last('lobby')!.players.find((p) => p.team === 'blue')!.picked).toBe(true);
    room.message(b, JSON.stringify({ t: 'relic', id: offerB[0] }));
    expect(carried(a)).toEqual([[offerA[1]], [offerB[0]]]);
  });

  it('picks for whoever runs out of time', () => {
    const { room, a, b } = relicRoom();
    room.message(a, JSON.stringify({ t: 'relic', id: a.last('relicOffer')!.offer[2] }));
    vi.advanceTimersByTime(RELIC_SECONDS * 1000);
    const [mine, theirs] = carried(b);
    expect(mine).toEqual([a.last('relicOffer')!.offer[2]]);
    expect(b.last('relicOffer')!.offer).toContain(theirs[0]);
  });

  it('goes back to the lobby if someone leaves while choosing, and plain duels carry nothing', () => {
    const { room, a, b } = relicRoom();
    room.leave(b);
    expect(a.last('lobby')).toMatchObject({ picking: false });
    vi.advanceTimersByTime(RELIC_SECONDS * 1000);
    expect(a.last('start')).toBeUndefined();

    const c = new FakeSocket();
    room.add(c);
    room.message(a, JSON.stringify({ t: 'relics', on: false }));
    room.message(a, JSON.stringify({ t: 'ready', ready: true }));
    room.message(c, JSON.stringify({ t: 'ready', ready: true }));
    expect(c.last('relicOffer')).toBeUndefined();
    expect(carried(c)).toEqual([[], []]);
  });
});
