// Exercise the title matcher against the real card index.
//
// The corpus is real Mercari titles captured 2026-08-28, including the awkward
// ones: a bare "Photocard", a bundle, and a P1Harmony card that is not in the
// library at all. Run after touching matcher.js or adding aliases.
//
//   node tools/test_matcher.mjs            summary
//   node tools/test_matcher.mjs --verbose  per-title detail
//
// Requires data/card-index.json (see tools/export_card_index.py).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { buildIndex, matchTitle } = await import(
  pathToFileURL(resolve('extension/lib/matcher.js')).href
);

const index = buildIndex(
  JSON.parse(readFileSync('data/card-index.json', 'utf8')).cards
);

// `expect` is a substring the top candidate's origin should contain, or null
// where no correct answer exists in the library.
const CASES = [
  ['STRAY KIDS HYUNJIN THIS & THAT PHOTOCARD KPOPNARA EXCLUSIVE', 'This & That'],
  ['Stray Kids Han KARMA Double Sided Photocard', 'KARMA'],
  ['Stray Kids Hyunjin 5 star POB photocard', 'Star'],
  ['stray kids skz hyunjin hop hmv photocard', 'HOP'],
  ['Stray Kids Felix 5-Star Apple Music POB Photocard', 'Star'],
  ['BANG CHAN KMS 2.0 POB', null],
  ['SKZ Lee Know Japan online benefit lottery pc', 'Japan'],
  ['Stray Kids This & That Official Photocard Unit Minsung', 'This & That'],
  ['Hyunjin Rockstar Photocard', 'Rock Star'],
  ['Stray Kids Hyunjin Maxident Photocard Set', 'Maxident'],
  ['Stray Kids Hyunjin : This & That ID Ver.', 'This & That'],
  ['STRAY KIDS HYUNJIN ZOOTOPIA 2 X SKZOO POB PHOTOCARD', null],
  ['Stray Kids Hyunjin In Life Double Sided photocard', 'In Life'],
  ['Stray Kids 5-Star Changbin Photocard Barnes & Noble Exclusive', 'Star'],
  // Deliberately unmatchable — these must degrade, not pretend.
  ['Photocard', null],
  ['♡ Stray Kids Photocard Bundle (7 PC’s!) + Freebies ♡', null],
  ['p1harmony Jongseob photocard', null],
];

const verbose = process.argv.includes('--verbose');
const label = (c) =>
  `#${c.id} ${c.members.join('+') || '—'} / ${c.origin || '—'} / ${c.version || '—'}`;

let hits = 0;
let scoped = 0;
const expected = CASES.filter(([, e]) => e).length;

for (const [title, expect] of CASES) {
  const r = matchTitle(title, index, { limit: 3 });
  const top = r.cards[0];
  const ok = expect ? (top?.origin || '').includes(expect) : null;
  if (ok) hits++;
  if (r.total <= 25) scoped++;

  if (verbose || ok === false) {
    const chips = r.chips
      .filter((c) => c.active)
      .map((c) => (c.ignored ? `(${c.value})` : c.value))
      .join(' · ');
    const mark = ok === false ? 'MISS' : ok ? 'ok' : '—';
    console.log(`\n[${mark}] "${title}"`);
    console.log(`  chips: ${chips || '(none)'}${r.widened ? '  [widened]' : ''}`);
    console.log(
      `  ${r.total} candidates${r.lowConfidence ? '  [low confidence]' : ''}`
    );
    for (const c of r.cards) console.log(`    ${label(c)}`);
  }
}

console.log(
  `\ntop-hit origin correct: ${hits}/${expected}` +
    `   narrowed to <=25: ${scoped}/${CASES.length}` +
    `   library: ${index.total.toLocaleString()} cards`
);
