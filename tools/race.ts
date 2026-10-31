// npm run race — finish times of player bots on every race track against the AI rivals.
//   pro (planner, 0 ms) should win every track; naive should lose. RACE_SET="race.lengthMul=0.8" tries values.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { EventBus, type GameEvents } from '../src/core/events';
import type { BotPolicy } from '../src/sim/bot';
import { Race } from '../src/sim/race';
import { applyTuning, parseTuning } from '../src/tuning';

applyTuning(parseTuning(JSON.parse(readFileSync('tuning.json', 'utf8'))));
for (const kv of (process.env.RACE_SET ?? '').split(',').filter(Boolean)) {
  const [path, val] = kv.split('=');
  const keys = path.trim().split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = Number(val);
}

const PLAYERS: [string, BotPolicy, number][] = [
  ['naive', 'naive', 0],
  ['p100', 'planner', 6],
  ['p50', 'planner', 3],
  ['pro', 'planner', 0],
];
const rows: Record<string, string | number>[] = [];
const fmt = (x: { t: number; est: boolean }, out: boolean): string => (out ? 'OUT' : `${x.t.toFixed(1)}${x.est ? '~' : ''}`);
for (let ti = 0; ti < CONFIG.race.tracks.length; ti++) {
  for (const [name, pol, delay] of PLAYERS) {
    const race = new Race(ti, new EventBus<GameEvents>(), { policy: pol, delay });
    while (race.phase !== 'done') race.step(false);
    const st = race.standings();
    const row: Record<string, string | number> = { track: race.track.name, player: name, place: `${st.indexOf(race.player) + 1}/${st.length}` };
    for (const r of race.racers) row[r.isPlayer ? 'you s' : r.name] = fmt(race.timeOf(r), r.out);
    const m = race.track.medals, pt = race.timeOf(race.player).t;
    row.medal = race.player.out ? '-' : pt <= m[0] ? 'gold' : pt <= m[1] ? 'silver' : pt <= m[2] ? 'bronze' : '-';
    rows.push(row);
  }
}
console.log('\nRace — finish times (s; ~ = estimated, not finished when the race ended; OUT = caught by the night)\n');
console.table(rows);
