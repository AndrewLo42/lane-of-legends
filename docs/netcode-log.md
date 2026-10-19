# Online lag log

A record of the investigation into online 1v1 lag: what was measured, what changed, and what's still open.

## The complaint (2026-10-19)

Online 1v1 felt very laggy, and the ping readout stayed high no matter how far apart the players were.

## How to measure

- **In game:** the readout in the top-left corner during an online duel shows four numbers. Hover it for an explanation of each. Each number is colored by its own health (green, yellow or red).
  - **Ping:** the time from sending a command to the server confirming it.
  - **Jitter (±):** how unevenly snapshots arrive.
  - **FPS:** frames drawn per second.
  - **KB/s:** the download rate.
- **From a terminal:** `node tools/netprobe.mjs` connects two fake players to the live server for about 15 seconds. Pass a host such as `localhost:8787` to test a local server instead. It reports:
  - plain HTTP ping;
  - command-to-confirmation time;
  - the gaps between snapshots;
  - snapshot size;
  - the server's ticks per second.

## Findings, before any changes (live server, from the dev Mac)

| What | Result |
|---|---|
| HTTP ping | about 30–100 ms |
| Command to confirmation | 54 ms typical, 66 ms at worst 1 in 10, 88 ms max |
| Snapshots | a steady 30 a second, 33 ms apart typically, up to 83 ms |
| Snapshot size | **8–10 KB each**, about **255 KB/s per player** (about 2 Mbit/s) |

The server itself was healthy: it held 30 ticks a second and didn't fall behind. The likely causes, in order:

1. **Heavy snapshots.** The whole world, every unit with every field, was sent 30 times a second. On Wi-Fi or a busy network, that stream can back up, and then every message waits in line. That raises ping regardless of distance.
2. **Waiting built into the game.**
   - The server applied a command only at its next tick, adding up to 33 ms.
   - The client sends input and reads snapshots once per frame, so a low frame rate adds more.
   - The old ping readout included all of this.
3. **Jitter.** Other units are drawn from only the last two snapshots, so a late snapshot makes them hitch.
4. **Only walking is predicted.** Attacks and casts wait for the full ping.

## Changes (commit `5da4544`, deployed 2026-10-19)

1. **Snapshots send only what changed** (`src/net/protocol.ts`).
   - Each player's cursor remembers what it last sent, field by field. A champion's `champ` (and a pet's `pet`) is compared one level down.
   - Zones and telegraphs are sent only when they change. Numbers are rounded to 3 decimals.
   - The full list of ids goes every tick, so the client drops anything that's gone. A fresh cursor, used on start or rejoin, sends everything.
   - Result: **about 950 bytes per snapshot, 20–30 KB/s per player** (live: about 734 bytes, 19 KB/s).
   - Caveat: unchanged fields aren't resent, so the client restores the server's values for its predicted champion before each snapshot (`restoreOwn` and `serverOwn` in `src/net/predict.ts`). Without that, a wrong prediction could stick. A test covers it.
2. **Early ticks** (`server/room.ts`, `PULL_MS = 15`).
   - A command that arrives, or is waiting, may run the next tick up to 15 ms early. The clock never gets more than 15 ms ahead, and it still averages 30 ticks a second.
   - Result locally: about 22 ms → **9 ms** typical, and 34 ms → 19 ms at worst 1 in 10. Same on the local Cloudflare Worker: about 25 ms → 9 ms.
   - Cost: when commands are sparse, snapshots arrive a little less evenly, up to about 48 ms apart.
3. **Network readout** (`src/duel.ts`, `showPing`). It shows ping, jitter, FPS and KB/s, updated twice a second. Ping is now timed to when the snapshot arrives, not to when it's drawn.

**After deploying:** snapshot size is confirmed live. The ping couldn't be compared fairly, because the dev Mac's connection was very noisy at the time: HTTP ping was 185–480 ms, with one outlier of 4 seconds. Command-to-confirmation measured 67–85 ms.

## Open: what to try next, depending on what players see

Waiting on numbers from a real game: the readout for both players.

- **Ping high, the rest green:** it's the network path. The room lives in a Durable Object near whoever created it, so the player farther from it pays the difference.
- **Jitter high (more than about 12 ms):** item 3, an interpolation buffer. Draw other units about 50 ms in the past from a small buffer of snapshots instead of the last two. This also hides the uneven spacing from early ticks.
- **FPS low:** that player's machine. Look at render cost, or offer a low-graphics option.
- **Actions still feel slow with an OK ping:** item 4, predict attacks and casts on your own screen. Start the animation and effects straight away, and let the server decide what hits.
- **Smaller:** send input the moment it happens instead of on the next frame (saves about half a frame). Process snapshots as they arrive. Or raise `PULL_MS` if the extra jitter turns out not to matter.
