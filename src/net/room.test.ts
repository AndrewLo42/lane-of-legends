import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Socket } from '../../server/room';
import { SEAT_GRACE, type ServerMsg } from './protocol';

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
