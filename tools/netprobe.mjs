// Two fake players on a PvP server: measure HTTP RTT, command->ack RTT, snapshot cadence and size, server tick rate.
// Usage: node tools/netprobe.mjs [host]   (default: the live server; e.g. localhost:8787 for a local one). Runs ~17 s and creates one room.
const HOST = process.argv[2] ?? 'lane-league.crevice.workers.dev';
const secure = !HOST.startsWith('localhost');
const http = `${secure ? 'https' : 'http'}://${HOST}`;
const ws = `${secure ? 'wss' : 'ws'}://${HOST}`;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]?.toFixed(1); };
const h = [];
for (let i = 0; i < 6; i++) { const t = performance.now(); await fetch(`${http}/health`); h.push(performance.now() - t); }
console.log('HTTP /health RTT ms: median', pct(h.slice(1), 0.5), 'all', h.map((x) => x.toFixed(0)).join(' '));
const open = (url) => new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = rej; });
const a = await open(`${ws}/room/new`);
const code = await new Promise((res) => (a.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'lobby') res(m.code); }));
const b = await open(`${ws}/room/${code}`);
console.log('room', code);
let started = 0, seq = 0; const sent = new Map(); const rtts = []; const gaps = []; const sizes = []; let last = 0, firstTick = 0, firstAt = 0, lastTick = 0, lastAt = 0, acked = 0;
b.onmessage = () => {};
a.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'start') { started = performance.now(); console.log('duel started'); }
  if (m.t !== 'snap') return;
  const now = performance.now();
  sizes.push(e.data.length);
  if (last) gaps.push(now - last);
  last = now;
  if (!firstTick) { firstTick = m.snap.tick; firstAt = now; }
  lastTick = m.snap.tick; lastAt = now;
  if (m.snap.ack > acked) { const t = sent.get(m.snap.ack); if (t) rtts.push(now - t); acked = m.snap.ack; }
};
for (const s of [a, b]) s.send(JSON.stringify({ t: 'ready', ready: true }));
await new Promise((r) => setTimeout(r, 1500));
const timer = setInterval(() => {
  if (!started) return;
  seq++; sent.set(seq, performance.now());
  a.send(JSON.stringify({ t: 'cmds', seq, cmds: [{ type: 'move', to: { x: -60 + (seq % 2) * 4, y: (seq % 3) - 1 } }] }));
}, 100);
await new Promise((r) => setTimeout(r, 15000));
clearInterval(timer);
console.log('cmd->ack RTT ms: median', pct(rtts, 0.5), 'p90', pct(rtts, 0.9), 'max', pct(rtts, 1), `(${rtts.length})`);
console.log('snapshot gap ms: median', pct(gaps, 0.5), 'p90', pct(gaps, 0.9), 'p99', pct(gaps, 0.99), 'max', pct(gaps, 1), `(${gaps.length} snaps)`);
console.log('snapshot bytes: median', pct(sizes, 0.5), 'max', pct(sizes, 1), '=> KB/s', ((sizes.reduce((x, y) => x + y, 0) / 1024) / ((lastAt - firstAt) / 1000)).toFixed(0));
console.log('server ticks/s', ((lastTick - firstTick) / ((lastAt - firstAt) / 1000)).toFixed(1), '(should be 30)');
a.close(); b.close();
process.exit(0);
