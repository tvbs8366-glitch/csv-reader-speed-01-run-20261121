// The harness runs `node /bot/main.ts` (Node 22). It reads every case from
// /input/cases.json (a JSON array of {id, input}), answers each one alone
// with run() from solve.js, and writes /output/answers.json: a JSON array of
// the answers, one per case and in the cases' order. Outside a container
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Note: no V8 flag tuning here. The house baseline turns incremental
// marking off, but the rules leave the choice to the entry, and with it off
// this entry runs slower on the practice set (more full GC pauses while it
// builds and writes 12 MB of answers), so the default is kept.

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
