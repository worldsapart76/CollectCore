// Ranking check for the panel's free-text card search, against the real index.
//
// Imports matcher.js directly -- the scoring is pure, which is why it lives
// there rather than in cardIndex.js next to the IndexedDB plumbing.
//
//   node tools/test_search.mjs
//
// Needs data/card-index.json (same fixture as test_matcher.mjs), built with
// tools/export_card_index.py against a PROD database.
import { readFileSync } from 'node:fs';
import { searchCards, matchTitle, buildIndex } from '../extension/lib/matcher.js';

const cards = JSON.parse(readFileSync('data/card-index.json', 'utf8')).cards;
const label = (c) =>
  [(c.members || []).join(' + '), c.origin, c.version].filter(Boolean).join(' · ');

let fails = 0;
function check(cond, msg) {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
}

console.log(`library: ${cards.length.toLocaleString()} cards\n`);
console.log('--- the wanted card has to be ON the page, not merely in the set ---');
// Every match used to score identically, so the sort fell through to card id
// and the 60 shown were the 60 OLDEST matches. A good query could return 300
// hits and never show the one wanted, which reads as a broken search.
for (const [query, needle] of [
  ['hyunjin rock star', 'rock star'],
  ['hyunjin km station', 'km station'],
  ['felix maxident', 'maxident'],
  ['seungmin oddinary', 'oddinary'],
  ['han karma', 'karma'],
]) {
  const { cards: page, total } = searchCards(cards, query);
  const at = page.findIndex((c) => label(c).toLowerCase().includes(needle));
  check(at === 0, `"${query}" puts "${needle}" at #${at + 1} of ${page.length} shown (${total} matched)`);
}

console.log('\n--- every token must match, so typing more narrows ---');
const one = searchCards(cards, 'hyunjin').total;
const two = searchCards(cards, 'hyunjin rock star').total;
check(two < one, `"hyunjin" ${one} -> "hyunjin rock star" ${two}`);
check(searchCards(cards, 'hyunjin zzzznotathing').total === 0,
  'a token matching nothing yields nothing, rather than falling back to OR');

console.log('\n--- the count is the truth, not the page size ---');
const wide = searchCards(cards, 'hyunjin');
check(wide.total > wide.cards.length,
  `"hyunjin" reports ${wide.total} total while showing ${wide.cards.length}` +
  ' — the panel says "showing the closest 60"');

console.log('\n--- a tighter match outranks a looser one ---');
const rs = searchCards(cards, 'rock star');
rs.cards.slice(0, 3).forEach((c, i) => console.log(`  #${i + 1} ${label(c)}`));
// "Rock Star" is an ALBUM, so it lands in origin rather than version -- the
// point is that the top hit carries it as a whole field, not buried in a
// longer string somewhere.
const topField = [rs.cards[0].origin, rs.cards[0].version].find((f) =>
  /^rock ?star$/i.test((f || '').trim())
);
check(!!topField, `the top hit carries "Rock Star" as a whole field (${topField || 'none'})`);
// "rockstar" is how sellers write it, and the joined form has to still find it.
const joined = searchCards(cards, 'rockstar');
check(joined.total > 0, `"rockstar" (no space) still matches ${joined.total} cards`);

console.log('\n--- a member has to be findable by every name it goes by ---');
// I.N is the case that broke: tokenize() splits on non-alphanumerics and drops
// anything shorter than two characters, so "I.N" produced NO tokens at all and
// the search fell through to its no-query branch -- the whole library, in id
// order, looking exactly like a search that had stopped working.
//
// The aliases were a second half of the same hole. ALIASES has mapped jeongin
// and innie to I.N all along, but only matchTitle ever read it, so shorthand
// that worked on a listing title returned zero results typed into the box.
const isIN = (c) => (c.members || []).some((m) => m.toLowerCase() === 'i.n');
const inTotal = cards.filter(isIN).length;

for (const query of ['I.N', 'i.n', 'in', 'jeongin', 'innie', 'yangjeongin']) {
  const { cards: page, total } = searchCards(cards, query);
  const onPage = page.filter(isIN).length;
  check(
    onPage === page.length && total >= inTotal,
    `"${query}" fills the page with I.N (${onPage}/${page.length}, ${total} matched)`
  );
}

// The alias forms name exactly one member, so they should not drag anything
// else in with them -- unlike "in", which is also an ordinary English word.
check(
  searchCards(cards, 'jeongin').total === inTotal,
  `"jeongin" matches the ${inTotal} I.N cards and nothing else`
);

// Naming a member must not stop the same token being read as ordinary text.
check(
  searchCards(cards, 'all in').total < searchCards(cards, 'in').total,
  `"all in" still narrows to the era (${searchCards(cards, 'all in').total} cards)`
);

// The same treatment reaches every member, not just the punctuated one.
for (const [alias, canonical] of [['minho', 'lee know'], ['lino', 'lee know'], ['bangchan', 'bang chan']]) {
  const { cards: page } = searchCards(cards, alias);
  const hit = page.filter((c) =>
    (c.members || []).some((m) => m.toLowerCase() === canonical)
  ).length;
  check(hit === page.length && page.length > 0, `"${alias}" finds ${canonical} (${hit}/${page.length})`);
}

console.log('\n--- the member dropdown narrows the SET, not the page ---');
// The property that makes the filter worth having. searchCards caps at 60, so
// filtering what came back would answer "which of these 60 happen to be I.N"
// -- on "rock star" that is 16 cards when the real answer is 66.
{
  const hasMember = (c, m) => (c.members || []).includes(m);
  const wide = searchCards(cards, 'rock star');
  const narrow = searchCards(cards, 'rock star', { member: 'I.N' });
  const onPage = wide.cards.filter((c) => hasMember(c, 'I.N')).length;

  check(
    narrow.total > onPage,
    `"rock star" + I.N finds ${narrow.total}, not the ${onPage} I.N cards visible on the unfiltered page`
  );
  check(
    narrow.cards.every((c) => hasMember(c, 'I.N')),
    'every card returned under the filter carries that member'
  );
  check(
    narrow.total < wide.total,
    `the filter narrows (${wide.total} -> ${narrow.total})`
  );

  // No query at all: the dropdown alone is a legitimate way to browse.
  const bare = searchCards(cards, '', { member: 'I.N' });
  check(
    bare.total === cards.filter((c) => hasMember(c, 'I.N')).length,
    `member with no query returns that member's whole set (${bare.total})`
  );

  // The title path takes the same constraint, and it is the one filter there
  // that widening must never drop -- it is the user's answer, not an inference.
  const index = buildIndex(cards);
  const title = 'Stray Kids Felix Rock Star photocard';
  const contradicted = matchTitle(title, index, { memberFilter: 'I.N' });
  check(
    contradicted.total > 0 &&
      contradicted.cards.every((c) => hasMember(c, 'I.N')),
    `a member contradicting the title still holds (${contradicted.total} I.N cards, widened=${contradicted.widened})`
  );
  check(
    matchTitle(title, index, { memberFilter: 'Felix' }).total ===
      matchTitle(title, index).total,
    'a member agreeing with the title changes nothing'
  );
}

console.log('\n--- fast enough to type against ---');
const t0 = process.hrtime.bigint();
for (let i = 0; i < 20; i++) searchCards(cards, 'hyunjin rock star');
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
check(ms < 120, `${ms.toFixed(1)} ms per search over ${cards.length.toLocaleString()} cards`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
