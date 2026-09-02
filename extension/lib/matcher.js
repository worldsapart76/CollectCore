// Narrows the card picker from a listing title.
//
// Filters, never selects. Every inference is surfaced as a removable chip, and
// the result set is never empty — a filter that hides the right card without
// saying why is worse than no filter at all.
//
// Pure: no chrome.* and no DOM, so it can be exercised in Node against real
// captured titles.

// --- Tokenizing ------------------------------------------------------------

// Latin only for now. Neokyo titles are Japanese and need their own path —
// segmentation plus a kana/kanji alias layer — which is why the alias table
// below is the seam that work will hang off.
export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// Member names that never survive tokenizing, plus the fan shorthand that
// shows up in listing titles far more often than official names do.
//
// This table is the thing that compounds: every confirmed association where
// the title used an unknown alias is a candidate row to add here.
export const ALIASES = {
  jisung: 'Han',
  hanjisung: 'Han',
  chan: 'Bang Chan',
  bangchan: 'Bang Chan',
  christopher: 'Bang Chan',
  minho: 'Lee Know',
  lino: 'Lee Know',
  leeknow: 'Lee Know',
  knowlee: 'Lee Know',
  jeongin: 'I.N',
  yangjeongin: 'I.N',
  innie: 'I.N',
  jeongins: 'I.N',
  binnie: 'Changbin',
  seobin: 'Changbin',
  hwang: 'Hyunjin',
  hyunjinnie: 'Hyunjin',
  lix: 'Felix',
  minnie: 'Seungmin',
  dami: 'Seungmin',
};

// "I.N" tokenizes to nothing usable and "in" is a preposition — matching it
// would tag half the library. Handled by alias only, never by token.
const UNTOKENIZABLE = new Set(['I.N']);

// Words that are ubiquitous in listing TITLES regardless of how rare they are
// in the library. Document frequency cannot catch these: "skz" appears in only
// a handful of version strings, so it scores as highly discriminating, yet
// nearly every Stray Kids listing contains it — letting it filter buried the
// real signal ("hop", "hmv") underneath it.
const TITLE_STOPWORDS = new Set([
  'stray', 'kids', 'straykids', 'skz', 'kpop', 'official',
  'photocard', 'photocards', 'card', 'cards', 'pc', 'pcs',
  'ver', 'version', 'new', 'rare', 'mint', 'sealed', 'authentic',
]);

// Kana, kanji and full-width punctuation. Nothing here survives tokenize(),
// which is Latin-only, so a title made of these produces no chips at all.
// Written as script properties rather than as codepoint ranges: it says what it
// means, and a range whose endpoints are raw CJK characters is a line nobody
// can proofread.
const HAS_CJK = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

// --- Index -----------------------------------------------------------------

// Sellers write "Rockstar" where the library says "Rock Star", and "ThisThat"
// for "This & That". Indexing the joined form too costs nothing and rescues a
// whole class of near-misses. Capped at 3 words — joining a 49-character
// version produces a string no title will ever contain.
function withJoined(text) {
  const parts = tokenize(text);
  if (parts.length >= 2 && parts.length <= 3) {
    return [...parts, parts.join('')];
  }
  return parts;
}

// Which field a token came from, because that decides how much it is trusted:
// origin is identity (which era/album), version is mostly format. When a title
// cannot satisfy both, the era is the one worth keeping.
function cardTokensByField(card) {
  const out = new Map();
  const add = (token, field) => {
    const fields = out.get(token);
    if (fields) fields.add(field);
    else out.set(token, new Set([field]));
  };

  for (const m of card.members || []) {
    if (UNTOKENIZABLE.has(m)) continue;
    for (const t of tokenize(m)) add(t, 'member');
  }
  for (const t of withJoined(card.origin)) add(t, 'origin');
  for (const t of withJoined(card.version)) add(t, 'version');
  return out;
}

/**
 * Inverted index over member / origin / version tokens.
 *
 * `df` (document frequency) is what makes the filter usable: "photocard"
 * appears in 107 of 626 versions and discriminates nothing, while "withmuu"
 * appears in one and pins the card exactly. Frequency decides which tokens are
 * allowed to filter, rather than a hand-maintained stopword list.
 */
export function buildIndex(cards) {
  const byToken = new Map();
  const byId = new Map();
  const tokenFields = new Map();

  for (const card of cards) {
    byId.set(card.id, card);
    for (const [t, fields] of cardTokensByField(card)) {
      let bucket = byToken.get(t);
      if (!bucket) byToken.set(t, (bucket = new Set()));
      bucket.add(card.id);

      let seenFields = tokenFields.get(t);
      if (!seenFields) tokenFields.set(t, (seenFields = new Set()));
      for (const f of fields) seenFields.add(f);
    }
  }

  const memberByAlias = new Map();
  for (const [alias, member] of Object.entries(ALIASES)) {
    memberByAlias.set(alias, member);
  }
  for (const card of cards) {
    for (const m of card.members || []) {
      for (const t of tokenize(m)) memberByAlias.set(t, m);
      memberByAlias.set(m.toLowerCase().replace(/[^a-z0-9]/g, ''), m);
    }
  }

  return { byToken, byId, tokenFields, memberByAlias, total: cards.length };
}

// A token in more than this share of the library tells you nothing. Tuned
// against the real index: "photocard", "version", "set", "event" land above it;
// "withmuu", "soundwave", "karma", "yes24" land far below.
const MAX_DF_RATIO = 0.15;

// Origin tokens outrank version tokens of equal rarity. Without this the
// intersection can discard the era to keep a format word: "Han KARMA Double
// Sided" dropped KARMA and returned Han double-sided cards from three other
// eras, which is precisely backwards.
const FIELD_BOOST = { origin: 2.2, member: 2.2, version: 1 };

function weight(token, index) {
  const df = index.byToken.get(token)?.size ?? 0;
  if (df === 0) return 0;
  if (df / index.total > MAX_DF_RATIO) return 0;

  const fields = index.tokenFields.get(token) || new Set();
  let boost = 1;
  for (const f of fields) boost = Math.max(boost, FIELD_BOOST[f] ?? 1);

  return Math.log(index.total / df) * boost;
}

// --- Matching --------------------------------------------------------------

/**
 * @returns {{chips: Array, cards: Array, widened: boolean}}
 *   chips  — what was inferred, in confidence order, each removable by the UI
 *   cards  — candidates, best first, never empty while the library is non-empty
 *   widened — true when chips had to be dropped to avoid an empty result
 */
export function matchTitle(title, index, { limit = 60, drop = [] } = {}) {
  const tokens = tokenize(title);
  const dropped = new Set(drop);

  const chips = [];
  const seen = new Set();

  // Members first: 8 possible values, alias-backed, by far the most reliable
  // signal in a title.
  const consumed = new Set();
  for (const t of tokens) {
    const member = index.memberByAlias.get(t);
    if (!member) continue;
    consumed.add(t);
    if (seen.has(`member:${member}`)) continue;
    seen.add(`member:${member}`);
    chips.push({ kind: 'member', value: member, token: t, weight: 100 });
  }

  // Then whatever else discriminates, ranked by how rare it is.
  for (const t of tokens) {
    if (TITLE_STOPWORDS.has(t)) continue;
    // Already represented by a member chip — "Hyunjin · hyunjin" is noise.
    if (consumed.has(t) || seen.has(`token:${t}`)) continue;
    const w = weight(t, index);
    if (w <= 0) continue;
    seen.add(`token:${t}`);
    chips.push({ kind: 'token', value: t, token: t, weight: w });
  }

  chips.sort((a, b) => b.weight - a.weight);
  for (const c of chips) c.active = !dropped.has(c.token);

  const active = chips.filter((c) => c.active);
  let widened = false;
  let pool = null;

  // Intersect strongest-first, and stop before any chip empties the set. A
  // near-miss title must still land you in the right neighbourhood rather than
  // on a blank screen.
  for (const chip of active) {
    const bucket =
      chip.kind === 'member'
        ? memberBucket(chip.value, index)
        : index.byToken.get(chip.token);
    if (!bucket || bucket.size === 0) {
      widened = true;
      chip.ignored = true;
      continue;
    }
    if (pool === null) {
      pool = new Set(bucket);
      continue;
    }
    const next = new Set();
    for (const id of pool) if (bucket.has(id)) next.add(id);
    if (next.size === 0) {
      widened = true;
      chip.ignored = true;
      continue;
    }
    pool = next;
  }

  const ids = pool ? [...pool] : [...index.byId.keys()];

  // Rank within the surviving set by total weight of chips each card matches,
  // so the most specific candidates float even when the filter is broad.
  const scored = ids.map((id) => {
    const card = index.byId.get(id);
    let score = 0;
    for (const chip of active) {
      const bucket =
        chip.kind === 'member'
          ? memberBucket(chip.value, index)
          : index.byToken.get(chip.token);
      if (bucket?.has(id)) score += chip.weight;
    }
    return { card, score };
  });

  scored.sort((a, b) => b.score - a.score || a.card.id - b.card.id);

  return {
    chips,
    widened,
    // No member matched: most likely another group entirely (the sample had
    // P1Harmony and ENHYPEN rows), so the picker should say so rather than
    // present 1,400 confident-looking candidates.
    lowConfidence: !chips.some((c) => c.kind === 'member'),
    // A Japanese title yields no Latin tokens, so nothing filters and the
    // whole library comes back looking like a confident result. Saying the
    // title could not be read is the honest answer, and it points at the
    // search box instead of at 11,000 candidates.
    unreadableTitle: !chips.length && HAS_CJK.test(title || ''),
    total: scored.length,
    cards: scored.slice(0, limit).map((s) => s.card),
  };
}

const memberBuckets = new WeakMap();

function memberBucket(member, index) {
  let cache = memberBuckets.get(index);
  if (!cache) memberBuckets.set(index, (cache = new Map()));
  if (cache.has(member)) return cache.get(member);
  const set = new Set();
  for (const [id, card] of index.byId) {
    if ((card.members || []).includes(member)) set.add(id);
  }
  cache.set(member, set);
  return set;
}

// --- Free-text search ------------------------------------------------------

// How well one token matches one field. Bigger is tighter.
//
// Every match used to score the same 1, and since a card only survived when
// EVERY token matched, every survivor tied on score -- so the sort fell
// through to card id and the 60 shown were simply the 60 oldest matches. With
// 11,000 cards that meant a good query could return 300 hits and never show
// yours, which reads as the search being broken rather than truncated.
const EQUALS = 5;
const WHOLE_WORD = 4;
const WORD_PREFIX = 3;
const JOINED = 2;      // "rockstar" matching the field "Rock Star"
const ANYWHERE = 1;

function tokenScore(token, field, joined, wordRe, prefixRe) {
  if (!field) return 0;
  if (field === token) return EQUALS;
  if (wordRe.test(field)) return WHOLE_WORD;
  if (prefixRe.test(field)) return WORD_PREFIX;
  if (joined.includes(token)) return JOINED;
  if (field.includes(token)) return ANYWHERE;
  return 0;
}

// Tokens go into a RegExp below, so they must not carry regex metacharacters.
// They cannot: tokenize() lowercases and splits on /[^a-z0-9]+/, so a token is
// always plain [a-z0-9]. Asserted rather than escaped, because an escape here
// would quietly paper over a change to tokenize() that made it untrue.
const SAFE_TOKEN = /^[a-z0-9]+$/;

// --- Finding a member by whatever the user typed ----------------------------

// A dotted initialism is invisible to tokenize(): it splits on
// non-alphanumerics and drops anything under two characters, so "I.N" yields
// NOTHING AT ALL. A search for it therefore took the no-tokens branch below and
// returned the whole library unfiltered -- 11,323 cards, in id order, looking
// for all the world like a search that had simply broken.
//
// Collapsing the dots between letters first makes it the single token "in".
// Applied to the QUERY only, not inside tokenize(): matchTitle and the inverted
// index are a separate question with their own tests, and this is the panel's
// free-text search.
function collapseInitials(text) {
  return (text || '').replace(/([a-z])\.(?=[a-z])/gi, '$1');
}

const memberKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// token -> canonical member name. Built from the library's own members plus the
// alias table, so "i.n", "in", "jeongin", "innie" and "yangjeongin" all arrive
// at the same place -- and so does every other member, without a second table
// to keep in step with the first.
//
// ALIASES existed all along but only matchTitle consulted it, so the fan
// shorthand that works on a listing title returned zero results when typed into
// the search box. Same vocabulary, two behaviours.
const memberLookups = new WeakMap();

function memberLookup(cards) {
  let map = memberLookups.get(cards);
  if (map) return map;
  map = new Map();
  for (const card of cards) {
    for (const m of card.members || []) {
      map.set(memberKey(m), m);
      for (const t of tokenize(m)) map.set(t, m);
    }
  }
  // After the real names, so a stale alias can never shadow a member the
  // library actually holds.
  for (const [alias, member] of Object.entries(ALIASES)) {
    if (!map.has(memberKey(alias))) map.set(memberKey(alias), member);
  }
  memberLookups.set(cards, map);
  return map;
}

/**
 * Free-text search over the whole library, for when the title inferred nothing
 * useful and the card has to be found by hand.
 *
 * Every token must match somewhere (typing more words narrows, as expected),
 * but HOW each one matched decides the order: a card whose version is exactly
 * "Rock Star" outranks one that merely contains those letters. Returns the
 * true total alongside the page, because a count capped at the page size reads
 * as "60 matches" forever and gives no signal that typing more would help.
 */
export function searchCards(cards, query, { limit = 60 } = {}) {
  const tokens = tokenize(collapseInitials(query));
  if (tokens.length === 0) {
    return { cards: cards.slice(0, limit), total: cards.length };
  }

  const members = memberLookup(cards);

  // One regex per token, not per token per card: 11,000 cards times a fresh
  // RegExp each was the difference between instant and noticeable.
  const probes = tokens.filter((t) => SAFE_TOKEN.test(t)).map((t) => ({
    t,
    wordRe: new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`),
    prefixRe: new RegExp(`(^|[^a-z0-9])${t}`),
    // The member this token names, if it names one. Checked as a set
    // membership rather than as text, which is what lets "in" find I.N without
    // also promoting every card whose origin merely contains those letters.
    member: members.get(t) || null,
  }));
  if (!probes.length) {
    return { cards: cards.slice(0, limit), total: cards.length };
  }

  const scored = [];
  for (const card of cards) {
    const fields = [
      (card.members || []).join(' ').toLowerCase(),
      (card.origin || '').toLowerCase(),
      (card.version || '').toLowerCase(),
    ];
    const joined = fields.map((f) => f.replace(/[^a-z0-9]/g, ''));

    let score = 0;
    let matchedAll = true;
    for (const p of probes) {
      // Naming a member the card actually has is the strongest claim available,
      // so it scores as an exact hit. It does NOT short-circuit a miss: a token
      // that happens to name a member can still be meant as ordinary text --
      // "chan" naming Bang Chan must not stop it matching a version that says
      // Chan on a card by someone else.
      let best =
        p.member && (card.members || []).includes(p.member) ? EQUALS : 0;
      for (let i = 0; i < fields.length && best < EQUALS; i++) {
        const s = tokenScore(p.t, fields[i], joined[i], p.wordRe, p.prefixRe);
        if (s > best) best = s;
      }
      if (!best) {
        matchedAll = false;
        break;
      }
      score += best;
    }
    if (!matchedAll) continue;
    // Length breaks ties: among equally well-matched cards the one with less
    // text around the match is the tighter hit.
    scored.push({ card, score, len: fields.join(' ').length });
  }

  scored.sort(
    (a, b) => b.score - a.score || a.len - b.len || a.card.id - b.card.id
  );
  return {
    cards: scored.slice(0, limit).map((s) => s.card),
    total: scored.length,
  };
}
