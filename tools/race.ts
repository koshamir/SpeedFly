// npm run race — headless race check: every track, the player = a bot of each skill; places and times
// of all birds (pro must win, naive must lose).
import { readFileSync } from 'node:fs';
import { EventBus, type GameEvents } from '../src/core/events';
import { Bot, type BotPolicy } from '../src/sim/bot';
import { RaceRun } from '../src/sim/race';
import { applyTuning, parseTuning } from '../src/tuning';
import { TRACKS } from '../src/world/tracks';

applyTuning(parseTuning(JSON.parse(readFileSync('tuning.json', 'utf8'))));
const PLAYERS: [string, BotPolicy, number][] = [
  ['pro', 'planner', 0],
  ['p50', 'planner', 3],
  ['p100', 'planner', 6],
  ['naive', 'naive', 0],
];
const rows: Record<string, string | number>[] = [];
let ok = true;
TRACKS.forEach((def, tr) => {
  for (const [name, pol, d] of PLAYERS) {
    const race = new RaceRun(tr, new EventBus<GameEvents>());
    const bot = new Bot(race.run.world.terrain, pol, d);
    race.start();
    while (!race.done) race.step(bot.tick(race.run.bird));
    const fmt = (r: { finish: number; out: boolean }): string => (r.out ? 'slept' : r.finish >= 0 ? r.finish.toFixed(1) : 'dnf');
    if (name === 'pro' && race.place !== 1) ok = false;
    if (name === 'naive' && race.place === 1) ok = false;
    rows.push({ track: def.name, player: name, place: race.place || '—', 'player s': fmt(race.player), ...Object.fromEntries(race.ais.map((a) => [a.name, fmt(a)])) });
  }
});
console.table(rows);
console.log(`\nRACE CHECK (pro wins every track, naive never wins): ${ok ? 'PASS' : 'FAIL'}`);
process.exitCode = ok ? 0 : 1;
