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
