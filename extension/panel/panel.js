// Side panel: capture list, and the associate view where a listing gets tied
// to catalog cards.
//
// Read-only against the observation store — the service worker is the single
// writer, reached by message.

import * as cardIndex from '../lib/cardIndex.js';
import { apiFetch, SIGNIN_HINT } from '../lib/api.js';

const $ = (id) => document.getElementById(id);
// Prices are stored in the marketplace's own MINOR units, and how many minor
// units make one unit differs: 100 cents to the dollar, but the yen has no
// subunit at all. Dividing everything by 100 turned ¥1,200 into ¥12.00 and
// stamped a dollar sign on it -- the same currency bug that got the Neokyo fee
// fields entered wrong once already.
const EXPONENT = { USD: 2, JPY: 0, KRW: 0 };
const SYMBOL = { USD: '$', JPY: '¥', KRW: '₩' };

function money(minor, currency = 'USD') {
  if (minor == null) return '—';
  const code = (currency || 'USD').toUpperCase();
  const exp = EXPONENT[code] ?? 2;
  const sym = SYMBOL[code] || '';
  const n = (minor / 10 ** exp).toFixed(exp);
  // With no symbol for it, the code still has to be visible -- an unlabelled
  // bare number is how a foreign price gets read as dollars.
  return sym ? `${sym}${n}` : `${n} ${code}`;
}

// What a record's price is, in its own currency, with the marketplace's own
// USD conversion after it where there is one. Neokyo publishes that
// conversion; showing it is what makes a yen price comparable at a glance to
// the USD comps beside it.
function priceLabel(rec) {
  const native = money(rec.priceCents, rec.currency);
  const cur = (rec.currency || 'USD').toUpperCase();
  if (cur === 'USD') return native;
  const usdMinor = rec.sightings?.[rec.sightings.length - 1]?.priceUsd;
  return usdMinor == null ? native : `${native} (${money(usdMinor, 'USD')})`;
}

const send = (msg) => chrome.runtime.sendMessage(msg);

// Which listing the associate view is showing, and the chips switched off for
// it. Dropped chips are per-listing and deliberately not persisted: they are a
// refinement of one match, not a standing preference.
let current = null;
let dropped = new Set();
let armed = null;

// 'associate' ties a listing to cards; 'arm' picks the card to arm. Both use
// the same view and the same grid, so the mode has to live here rather than in
// a listener bolted onto individual tiles — re-rendering the grid (which
// typing in the search box does on every keystroke) would throw those away.
let viewMode = 'associate';

// --- Activation ------------------------------------------------------------

// Opening this panel turns capture on; closing it turns capture off. The port
// exists so the worker can observe that lifetime — onDisconnect is the only
// reliable "the panel went away" signal.
async function bindToActiveTab() {
  const port = chrome.runtime.connect({ name: 'panel' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) port.postMessage({ type: 'PANEL_INIT', tabId: tab.id });
}

// --- List view -------------------------------------------------------------

function tag(text, variant = '') {
  const el = document.createElement('span');
  el.className = `tag ${variant}`;
  el.textContent = text;
  return el;
}

function stateTag(rec) {
  const sold = rec.listingState === 'sold';
  const el = tag(sold ? 'sold' : 'active', sold ? 'sold' : 'active');
  el.title = `status: ${rec.rawStatus}`;
  return el;
}

function row(rec) {
  const li = document.createElement('li');
  li.className = 'row';

  const img = document.createElement('img');
  img.className = 'thumb';
  // `src = ''` resolves to the panel's own URL and renders as a BROKEN image,
  // which is a different claim: broken says the photo was captured and will not
  // load, missing says none was read. They point at different bugs, so they
  // must not look alike. Also covers a URL that 404s later, which is the same
  // situation arriving a different way.
  img.dataset.thumbKey = rec.key;
  img.dataset.thumbSrc = rec.thumbnailUrl || '';
  setThumb(img, rec.thumbnailUrl, rec.key);
  // After setThumb, which writes its own title: the "image N of M" hint has to
  // survive, and it is the only thing saying the pick can be changed.
  makePickable(img, rec);
  img.alt = '';
  img.loading = 'lazy';

  const body = document.createElement('div');
  body.className = 'body';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = rec.name || '(untitled)';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const price = document.createElement('span');
  price.className = 'price';
  price.textContent = priceLabel(rec);
  meta.append(price, stateTag(rec));
  if (rec.itemCondition) meta.append(tag(rec.itemCondition));
  if (rec.isLot) meta.append(tag('lot', 'warn'));
  else if (rec.suspectedLot) meta.append(tag('possible lot?', 'warn'));
  // Only when something is genuinely MISSING, not merely read another way.
  if (!rec.name) meta.append(tag('no title', 'warn'));
  if (rec.priceCents == null) meta.append(tag('no price', 'warn'));
  if (rec.sightings?.length > 1) meta.append(tag(`seen ${rec.sightings.length}×`));
  // 'detail' means shipping and description are known for this row; on a sweep
  // row they are merely unlooked-at.
  if (rec.captureTier === 'detail') meta.append(tag('detail'));
  meta.append(tag(rec.syncedAt ? 'synced' : 'not synced', rec.syncedAt ? '' : 'warn'));
  // The server's answer, not this record's. A listing re-captured after its
  // local record was cleared arrives with no lines and reads as unidentified
  // work; the cards are on the server, and a capture with no lines leaves them
  // there. Without this the honest move looks like the lossy one.
  if (!(rec.lines || []).length && rec.serverLines > 0) {
    meta.append(tag(`${rec.serverLines} on server`));
  }
  // Dates discovered on the item, shown under their ORIGINAL field names so
  // the one that means "sold" can be identified from a real capture instead of
  // assumed. See datesFrom() in content/fiber.js.
  for (const [k, iso] of Object.entries(rec.dates || {})) {
    meta.append(tag(`${k} ${iso.slice(0, 10)}`));
  }

  // Fiber-scan diagnostic, shown only when the read was poor. Mercari's own
  // page console is far too noisy for a diagnostic to be noticed in, and this
  // is the information needed to find where the real item object lives.
  // The scan dump is for a broken capture, not a merely unusual one.
  const scan = rec.scanKeys;
  if (scan && (!rec.name || rec.priceCents == null)) {
    const dbg = document.createElement('div');
    dbg.className = 'scan-debug';
    dbg.textContent =
      `fiber scan: ${scan.candidates ?? 0} candidate(s), best score ` +
      `${scan.bestScore ?? 0}` +
      (scan.stamped === false ? ` · NO STAMP: ${scan.why || scan.error || '?'}` : '') +
      (scan.stamped === true ? ` · stamped ${scan.bytes}b` : '') +
      (scan.error ? ` · error: ${scan.error}` : '') +
      (rec.borrowed?.length ? ` · from page: ${rec.borrowed.join(', ')}` : '') +
      (scan.photoShape ? ` · photo entry keys: [${scan.photoShape.join(', ')}]` : '') +
      ` — [${(scan.keys || []).join(', ') || 'none'}]` +
      ((scan.others || []).length > 1
        ? ` · others: ${scan.others.slice(1).map((k) => `[${k.join(', ')}]`).join(' ')}`
        : '');
    body.append(dbg);
  }

  // The same, for a site read from the DOM because it has no fiber. Shown on
  // the same condition -- a poor read -- and it answers the same question:
  // what did the page actually offer? Without it, "why is this one empty" can
  // only be settled by a screenshot and a round of guessing.
  // Shown when the read was WEAK, not only when it was empty.
  //
  // The original condition was "the title or price is missing", and it hid the
  // failure that actually happened three times over: a title that is present,
  // plausible, and identical on every listing -- "Item Details", then "About
  // Neokyo", then a category-menu entry. Nothing about those rows looked
  // wrong, so nothing asked to be looked at.
  //
  // `weak` is the content script's own verdict: the title did NOT come from
  // the element the site marks as seller-written, on a site that publishes
  // such a marker. A row that got the good source stays quiet.
  const dom = rec.domScan;
  // A missing photo counts. Identification is the job that image does, so its
  // absence is a failed read, not a cosmetic one -- and "which element did it
  // look at" is the only question worth asking about it.
  if (dom && (dom.weak || !rec.name || rec.priceCents == null || !rec.thumbnailUrl)) {
    const dbg = document.createElement('div');
    dbg.className = 'scan-debug';
    dbg.textContent =
      `page read: title from ${dom.titleFrom || 'nowhere'}` +
      ` · price from ${dom.scoped ? 'the price element' : 'the whole page'}` +
      ` — "${dom.priceText || 'nothing'}"` +
      ` · h1 "${dom.h1 || '—'}" · og "${dom.og || '—'}" · doc "${dom.doc || '—'}"` +
      (dom.cands?.length ? ` · candidates: ${dom.cands.join(' | ')}` : ' · candidates: none') +
      ` · photo from ${dom.photoFrom || 'nowhere'}` +
      (dom.photos?.length ? ` — images: ${dom.photos.join(' | ')}` : ' — images: none');
    body.append(dbg);
  }

  const lines = rec.lines || [];
  const assoc = document.createElement('button');
  assoc.type = 'button';
  assoc.className = lines.length ? 'assoc assoc-done' : 'assoc assoc-todo';
  assoc.textContent = lines.length
    ? lines.map((l) => l.label).join(' + ')
    : 'Identify →';
  assoc.addEventListener('click', () => openAssociate(rec));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'row-remove';
  del.title = rec.syncedAt
    ? 'Remove from this queue (CollectCore keeps it, and so is the photo)'
    : 'Delete — NOT synced, this is the only copy. The photo is kept.';
  del.textContent = '✕';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!rec.syncedAt &&
        !confirm('This capture has not been synced — deleting it loses it. Continue?')) {
      return;
    }
    await send({ type: 'REMOVE_ONE', key: rec.key });
    renderList();
  });

  body.append(name, meta, assoc);
  const dbgLine = body.querySelector('.scan-debug');
  if (dbgLine) body.append(dbgLine); // keep it last
  li.append(img, body, del);
  return li;
}

async function renderList() {
  const res = await send({ type: 'GET_ALL' });
  const records = (res?.records || []).sort((a, b) =>
    b.capturedAt.localeCompare(a.capturedAt)
  );

  $('count').textContent = String(records.length);
  // Identified on the server counts as identified: nagging about a listing
  // whose cards are already recorded invites re-doing work that was never lost.
  const todo = records.filter(
    (r) => !(r.lines || []).length && !(r.serverLines > 0)
  ).length;
  $('empty').hidden = records.length > 0;
  $('list').replaceChildren(...records.map(row));

  await renderIndexStatus(todo, statusNote);
}

function ago(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// The result of the last thing the user pressed -- synced, cleared, imported,
// or failed.
//
// It used to be written straight to the status line after the list re-rendered,
// and was destroyed twice over before anyone could read it: renderList() was
// not awaited, and marking records synced broadcasts STORE_CHANGED, which
// re-renders again. So a sync that worked and a sync that was never pressed
// looked identical, which is exactly the question that could not be answered
// from the panel. Held here instead, and re-rendered with everything else.
let statusNote = '';

function setStatus(note) {
  statusNote = note;
  renderIndexStatus();
}

async function renderIndexStatus(todo = null, note = '') {
  note = note || statusNote;
  const store = await cardIndex.load();
  if (!store) {
    $('index-status').textContent =
      note || 'No cards yet — Refresh cards to pull them from the server.';
    return;
  }
  const parts = [
    `${store.meta.count.toLocaleString()} cards`,
    ago(Date.now() - new Date(store.meta.importedAt).getTime()),
  ];
  if (todo) parts.push(`${todo} need identifying`);
  if (note) parts.push(note);
  $('index-status').textContent = parts.join(' · ');
}

async function refreshCards({ silent = false } = {}) {
  if (!silent) $('index-status').textContent = 'Refreshing from server…';
  const res = await cardIndex.refreshFromServer();
  if (res.ok) {
    await renderIndexStatus(null, 'refreshed');
    return;
  }
  if (silent) {
    // Auto-refresh failing is not worth interrupting for — the stored copy is
    // still usable, just older than we would like.
    await renderIndexStatus(
      null,
      res.reason === 'signin' ? 'refresh needs sign-in' : 'refresh failed'
    );
    return;
  }
  await renderIndexStatus(
    null,
    res.reason === 'signin' ? SIGNIN_HINT : `refresh failed: ${res.reason}`
  );
}

// --- Associate view --------------------------------------------------------

function chipEl(chip) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'chip';
  if (!chip.active || chip.ignored) el.classList.add('chip-off');
  el.textContent = chip.value;
  el.title = chip.ignored
    ? 'Ignored — applying it would have left no candidates'
    : chip.active
      ? 'Click to remove this filter'
      : 'Click to re-apply this filter';
  el.addEventListener('click', () => {
    if (dropped.has(chip.token)) dropped.delete(chip.token);
    else dropped.add(chip.token);
    renderCandidates();
  });
  return el;
}

function cardTile(card) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'card';

  const img = document.createElement('img');
  img.className = 'card-img';
  img.alt = '';
  img.loading = 'lazy';
  if (card.image) {
    img.src = card.image;
  } else {
    // Imageless cards stay pickable. They are rare and usually transient — a
    // card catalogued just before its scan lands — and hiding them would make
    // exactly the newest era unpickable.
    img.classList.add('card-img-missing');
  }

  const label = document.createElement('span');
  label.className = 'card-label';
  label.textContent = cardIndex.cardLabel(card);

  el.title = `#${card.id} ${cardIndex.cardLabel(card)}`;
  el.append(img, label);
  el.addEventListener('click', () =>
    viewMode === 'arm' ? armCard(card) : associate(card)
  );
  return el;
}

async function renderCandidates() {
  const store = await cardIndex.load();
  if (!store) {
    $('assoc-summary').textContent = 'Import a card index to pick cards.';
    $('assoc-grid').replaceChildren();
    $('assoc-chips').replaceChildren();
    return;
  }

  const query = $('assoc-search').value.trim();

  // Arming has no listing title to match against, so it is search-only.
  if (viewMode === 'arm' || query) {
    const { cards, total } = await cardIndex.search(query);
    $('assoc-chips').replaceChildren();
    // The count is the TRUE total, not the page. It used to be cards.length,
    // which is capped at the page size -- so every query said "60 match" no
    // matter how many there were, and there was no way to tell a query that
    // had narrowed to 60 from one that had narrowed to 600. Saying which it is
    // turns "keep typing" from guesswork into a decision.
    $('assoc-summary').textContent = query
      ? total > cards.length
        ? `${total.toLocaleString()} match "${query}" — showing the closest ${cards.length}`
        : `${total.toLocaleString()} match "${query}"`
      : 'Search for the card to arm.';
    $('assoc-grid').replaceChildren(...cards.map(cardTile));
    return;
  }

  const res = await cardIndex.suggest(current.name, { drop: [...dropped] });
  $('assoc-chips').replaceChildren(...res.chips.map(chipEl));

  const bits = [`${res.total.toLocaleString()} candidates`];
  if (res.unreadableTitle) {
    // Say it once and plainly. The matcher is Latin-only, so a Japanese title
    // filters nothing -- without this the panel shows the entire library and
    // looks like it simply failed.
    bits.push('Japanese title — not readable yet, search for the card');
  } else {
    if (res.widened) bits.push('widened to avoid an empty result');
    if (res.lowConfidence) bits.push('no member matched — may not be your group');
  }
  $('assoc-summary').textContent = bits.join(' · ');

  $('assoc-grid').replaceChildren(...res.cards.map(cardTile));
}

// A thumbnail, or a visibly deliberate blank.
//
// Identification is the job this image does, so its absence matters and has to
// be legible: "no photo" is a parser that read nothing, "broken" is a CDN that
// stopped serving. The dotted placeholder says which without a console.
function setThumb(img, url, key = null) {
  img.classList.toggle('thumb-empty', !url);
  img.title = url ? '' : 'No photo was read from the page';
  if (!url) {
    img.removeAttribute('src');
    return;
  }
  img.src = url;
  img.onerror = () => {
    img.classList.add('thumb-empty');
    img.title = 'The photo was captured but no longer loads';
    img.removeAttribute('src');
  };
  // The panel hotlinked too, so its own thumbnails went dead alongside the
  // app's -- on the very rows still waiting to be identified, which is where a
  // photo is the whole point. Upgrade to the stored blob when there is one.
  // Async and after the hotlink is already set, so a slow lookup shows the
  // remote image first rather than an empty square.
  if (key) upgradeThumb(img, key, url);
}

// `${key}|${photoUrl}` -> blob: URL, or null once the worker has said it holds
// nothing for it.
//
// Keyed on the PHOTO as well as the record, which is the whole point. Keyed on
// the record alone, picking a different image (makePickable, below) looked
// broken: SET_THUMB updated the record and re-cached the blob correctly, the
// row re-rendered with the newly picked hotlink -- and then this pasted the
// stale capture-time blob straight back over it. The photo could never be
// changed, which on a card whose captured image is its back is the difference
// between an identifiable row and a useless one.
const thumbUrls = new Map();

async function upgradeThumb(img, key, photoUrl) {
  const cacheKey = `${key}|${photoUrl}`;
  try {
    let url = thumbUrls.get(cacheKey);
    if (url === undefined) {
      const res = await send({ type: 'GET_IMAGES', keys: [key] });
      const dataUrl = res?.images?.[key];
      url = dataUrl
        ? URL.createObjectURL(await (await fetch(dataUrl)).blob())
        : null;
      thumbUrls.set(cacheKey, url);
    }
    if (!url) return;
    // The row may have been re-rendered -- onto a different listing, or onto a
    // different photo of this one -- while this was in flight. Only the element
    // still showing exactly what was asked for may be touched.
    if (img.dataset.thumbKey !== key || img.dataset.thumbSrc !== photoUrl) return;
    img.onerror = null;
    img.classList.remove('thumb-empty');
    img.src = url;
  } catch {
    // The hotlink is already in place; a failed upgrade changes nothing.
  }
}

// Click the thumbnail to step through the other images the page offered.
//
// Automatic selection cannot be made reliable across four marketplaces and
// whatever carousel plugin each one ships: a looping gallery clones its slides,
// so the first <img> in the document is routinely a copy of the LAST photo. One
// click beats another round of guessing at plugin internals -- and it works on
// the next marketplace too, which no amount of guessing does.
function makePickable(img, rec) {
  const photos = rec.photos || [];
  if (photos.length < 2) return;
  const at = photos.indexOf(rec.thumbnailUrl);
  img.classList.add('thumb-pick');
  img.title =
    `Image ${at < 0 ? '?' : at + 1} of ${photos.length} — click for the next one`;
  img.addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = photos[(at + 1) % photos.length];
    await send({ type: 'SET_THUMB', key: rec.key, url: next });
    // No local re-render: SET_THUMB broadcasts STORE_CHANGED, and letting the
    // list redraw from the store keeps the row and the record from disagreeing.
  });
}

function renderLines() {
  const lines = current.lines || [];
  const wrap = $('assoc-lines');
  if (!lines.length) {
    wrap.replaceChildren();
    return;
  }
  const els = lines.map((line, i) => {
    const el = document.createElement('span');
    el.className = line.lineType === 'card' ? 'line' : 'line line-other';
    el.textContent =
      line.label || (line.lineType === 'unidentified' ? 'unidentified' : 'item');
    if (line.qty > 1) {
      // Counts down as well as up: picking the card again counts up, and
      // without this the only way back from a mis-click is removing the line
      // and finding the card again.
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'line-x';
      minus.textContent = '−';
      minus.title = 'One fewer of this card';
      minus.addEventListener('click', async () => {
        await send({
          type: 'SET_LINE_QTY', key: current.key, index: i, qty: line.qty - 1,
        });
        line.qty -= 1;
        renderLines();
      });
      el.append(tag(`×${line.qty}`), minus);
    }
    // Shown because it is the number that decides how much of the lot's cost
    // this line carries, and a value typed in the wrong units is invisible
    // otherwise.
    if (line.valueCents != null) el.append(tag(money(line.valueCents, 'USD')));

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'line-x';
    x.textContent = '×';
    x.title = 'Remove this line';
    x.addEventListener('click', async () => {
      // By POSITION, not by cardId: two non-card lines are two different
      // things, and a card id cannot address either of them.
      await send({ type: 'REMOVE_LINE', key: current.key, index: i });
      current.lines = lines.filter((_, j) => j !== i);
      renderLines();
    });
    el.append(x);
    return el;
  });
  wrap.replaceChildren(...els);
}

// Value is asked for HERE rather than left to the analyzer because it is a
// judgement made while looking at the listing -- the photos, the condition, the
// set it belongs to. The ladder can price a card from its own comps; nothing
// can tell it what an album is worth.
function askValue(what) {
  const entered = prompt(
    `What would the ${what} sell for, in dollars, AFTER selling fees?\n\n` +
    `This is its share of the lot's value, which is what decides how much of ` +
    `the lot's cost it carries.\n\nLeave empty to set it later in the app.`
  );
  if (entered === null) return { cancelled: true };
  if (!entered.trim()) return { valueCents: null };
  const dollars = Number(entered);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { error: 'That needs to be a number, and not negative.' };
  }
  return { valueCents: Math.round(dollars * 100) };
}

async function addLine(line) {
  if (!current) return;
  await send({ type: 'ADD_LINE', key: current.key, line });
  current.lines = current.lines || [];
  current.lines.push({ cardId: null, ...line });
  if (current.lines.length > 1) {
    current.isLot = true;
    $('assoc-lot').checked = true;
  }
  renderLines();
}

$('assoc-noncard').addEventListener('click', async () => {
  const label = prompt('What is it? (album, photobook, keychain…)');
  if (!label?.trim()) return;
  const v = askValue(label.trim());
  if (v.cancelled) return;
  if (v.error) return setStatus(v.error);
  await addLine({
    lineType: 'non_card', label: label.trim(), qty: 1, valueCents: v.valueCents,
  });
});

$('assoc-unknown').addEventListener('click', async () => {
  const entered = prompt('How many cards in this lot can you not identify?', '1');
  if (entered === null) return;
  const qty = Number(entered);
  if (!Number.isInteger(qty) || qty < 1) {
    return setStatus('That needs to be a whole number, at least 1.');
  }
  // No value asked for: the analyzer prices an unidentified card at its era's
  // median, which is a better guess than one made from a thumbnail.
  await addLine({ lineType: 'unidentified', label: null, qty, valueCents: null });
});

async function associate(card) {
  if (!current) return;
  await send({
    type: 'ASSOCIATE',
    key: current.key,
    card: { id: card.id, label: cardIndex.cardLabel(card) },
  });
  current.lines = current.lines || [];
  const line = current.lines.find((l) => l.cardId === card.id);
  if (line) {
    // Picking the same card again means a second COPY of it, which a lot really
    // can hold. It used to mean nothing at all, so the extra copy was
    // uncountable and the lot's cost split across one fewer card than it held.
    line.qty = (line.qty || 1) + 1;
  } else {
    current.lines.push({
      lineType: 'card',
      cardId: card.id,
      label: cardIndex.cardLabel(card),
      qty: 1,
    });
  }
  if (current.lines.length > 1 || (line?.qty || 0) > 1) {
    current.isLot = true;
    $('assoc-lot').checked = true;
  }
  renderLines();
  // Deliberately stays open: a lot needs several cards, and bouncing back to
  // the list after each one would make multi-line entry miserable.
}

function openAssociate(rec) {
  viewMode = 'associate';
  current = rec;
  dropped = new Set();

  $('assoc-img').hidden = false;
  $('assoc-open').hidden = false;
  $('assoc-lot').closest('.assoc-actions').hidden = false;

  $('assoc-img').dataset.thumbKey = rec.key;
  $('assoc-img').dataset.thumbSrc = rec.thumbnailUrl || '';
  setThumb($('assoc-img'), rec.thumbnailUrl, rec.key);
  makePickable($('assoc-img'), rec);
  $('assoc-name').textContent = rec.name || '(untitled)';
  $('assoc-open').href = rec.listingUrl;
  $('assoc-lot').checked = !!rec.isLot;
  $('assoc-search').value = '';

  const facts = [priceLabel(rec)];
  if (rec.itemCondition) facts.push(rec.itemCondition);
  facts.push(rec.listingState);
  $('assoc-facts').textContent = facts.join(' · ');
  $('assoc-progress').textContent = rec.suspectedLot ? 'possible lot' : '';

  renderLines();
  renderCandidates();

  $('view-list').hidden = true;
  $('view-associate').hidden = false;
}

function closeAssociate() {
  viewMode = 'associate';
  current = null;
  $('view-associate').hidden = true;
  $('view-list').hidden = false;
  renderList();
}

// --- Armed mode ------------------------------------------------------------

function renderArmed() {
  const btn = $('arm');
  if (armed) {
    btn.textContent = `Armed: ${armed.label}  ×`;
    btn.classList.add('armed-on');
    btn.title = 'Click to disarm and return to Collecting';
  } else {
    btn.textContent = 'Collecting — click to arm a card';
    btn.classList.remove('armed-on');
    btn.title = 'Arm a card so every capture associates to it automatically';
  }
}

async function toggleArmed() {
  if (armed) {
    armed = null;
    await send({ type: 'SET_ARMED', card: null });
    renderArmed();
    return;
  }
  // Arming reuses the associate view's search: pick a card, and from then on
  // tile clicks seed line 1 with it.
  const store = await cardIndex.load();
  if (!store) {
    setStatus('Import a card index first.');
    return;
  }
  current = null;
  openArmPicker();
}

async function armCard(card) {
  armed = { id: card.id, label: cardIndex.cardLabel(card) };
  await send({ type: 'SET_ARMED', card: armed });
  renderArmed();
  closeAssociate();
}

function openArmPicker() {
  viewMode = 'arm';
  current = null;
  dropped = new Set();

  $('assoc-img').hidden = true;
  $('assoc-name').textContent = 'Arm a card';
  $('assoc-facts').textContent =
    'Every capture will associate to this card until you disarm.';
  $('assoc-open').hidden = true;
  $('assoc-lot').closest('.assoc-actions').hidden = true;
  $('assoc-search').value = '';
  $('assoc-lines').replaceChildren();
  $('assoc-progress').textContent = '';

  renderCandidates();

  $('view-list').hidden = true;
  $('view-associate').hidden = false;
}

// --- Import / export -------------------------------------------------------

// Push captures to CollectCore. Safe to press repeatedly: the server keys
// listings on (marketplace, external_id) and sightings on (listing, time), so
// a re-sync updates rather than duplicates. Nothing is deleted locally on
// success — until sync is automatic, the local copy stays the safety net.
$('sync').addEventListener('click', async () => {
  const got = await send({ type: 'GET_ALL' });
  const captures = got?.records || [];
  if (!captures.length) {
    setStatus('Nothing to sync.');
    return;
  }

  setStatus(`Syncing ${captures.length}…`);
  const res = await apiFetch('/market/captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captures }),
  });

  if (!res.ok) {
    setStatus(res.reason === 'signin' ? SIGNIN_HINT : `Sync failed: ${res.reason}`);
    return;
  }
  // Only now is the server a second copy, so only now is clearing safe.
  await send({ type: 'MARK_SYNCED', keys: captures.map((c) => c.key) });

  // What the server already holds for each listing, so a record re-captured
  // after being cleared locally stops reading as unidentified work. Its cards
  // are on the server; the extension simply no longer has a copy of them.
  const d = res.data;
  await send({ type: 'SET_SERVER_LINES', results: d.results || [] });
  await renderList();

  // "0 new listings" is the evidence that a refresh merged into the listing it
  // was meant to, rather than creating a second row beside it -- so it is
  // worth saying even though it reads like a nothing-happened number.
  setStatus(
    `Synced ${d.received} — ${d.listings_new} new listings, ` +
    `${d.sightings_new} new sightings. Safe to clear synced.`
  );
});

// Stored listing photos. These are what CollectCore renders for a listing whose
// marketplace has dropped the hotlinked photo, which every listing's does once
// it closes — so this is a one-shot rescue and the window is closing the whole
// time. Everything already rotted is unrecoverable; the point is to save what
// has not.
$('backfill').addEventListener('click', async () => {
  const stats = await send({ type: 'IMAGE_STATS' });
  const mb = ((stats?.bytes || 0) / 1048576).toFixed(1);
  if (!confirm(
    `Holding ${stats?.count ?? 0} listing photos (${mb} MB).\n\n` +
    `Fetch a local copy of every listing photo CollectCore does not have one ` +
    `for yet? Listings that have already closed will have had their photo ` +
    `dropped by the marketplace and cannot be recovered.`
  )) return;

  $('backfill').disabled = true;
  setStatus('Asking CollectCore which listings it has…');

  // Fetched HERE, not in the service worker. CollectCore sits behind Cloudflare
  // Access, and this page carries the CF_Authorization cookie on a cross-origin
  // fetch where the worker does not -- from there the request is bounced to the
  // Google redirect and reported as an expired sign-in on a session that is
  // fine. Every other authed call in this extension is made from the panel.
  const manifest = await apiFetch('/market/listings/images');
  if (!manifest.ok) {
    $('backfill').disabled = false;
    // 404/405 means the endpoint is not on the server yet, which is a deploy
    // and not a fault. Worth saying, because "http 405" reads like a bug in the
    // extension and sends you looking in the wrong place.
    const missing = /^http 40[45]/.test(manifest.reason || '');
    setStatus(
      missing
        ? 'Images need a CollectCore deploy — /market/listings/images is not live yet.'
        : manifest.reason === 'signin'
          ? SIGNIN_HINT
          : `Images failed: ${manifest.reason}`
    );
    return;
  }

  setStatus('Fetching listing photos…');
  const res = await send({
    type: 'BACKFILL_IMAGES',
    listings: manifest.data?.listings || [],
  });
  $('backfill').disabled = false;

  if (!res?.ok) {
    setStatus(`Images failed: ${res?.reason || 'no reply from the extension'}`);
    return;
  }
  setStatus(
    `Images: stored ${res.stored}, already had ${res.alreadyHeld}` +
    (res.failed ? `, ${res.failed} gone from the marketplace` : '')
  );
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'BACKFILL_PROGRESS') return;
  setStatus(`Fetching listing photos… ${msg.done}/${msg.total}`);
});

$('refresh').addEventListener('click', () => refreshCards());
$('import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const saved = await cardIndex.save(payload);
    setStatus(`Imported ${saved.count.toLocaleString()} cards.`);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`);
  }
  e.target.value = '';
  renderList();
});

$('export').addEventListener('click', async () => {
  const res = await send({ type: 'GET_ALL' });
  const blob = new Blob([JSON.stringify(res?.records || [], null, 2)], {
    type: 'application/json',
  });
  // A plain anchor download works from an extension page and avoids needing
  // the "downloads" permission just to save a file.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `collectcore-captures-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Clearing defaults to the SAFE half: records the server already has. An
// unsynced capture is the only copy in existence, so wiping those has to be
// asked for separately rather than being the same button.
$('clear').addEventListener('click', async () => {
  const all = await send({ type: 'GET_ALL' });
  const recs = all?.records || [];
  const synced = recs.filter((r) => r.syncedAt).length;
  const unsynced = recs.length - synced;

  if (!recs.length) {
    setStatus('Nothing to clear.');
    return;
  }
  if (synced) {
    if (!confirm(
      `Remove ${synced} synced capture${synced === 1 ? '' : 's'}? ` +
      `CollectCore keeps them.` +
      (unsynced ? `

${unsynced} unsynced will be kept here.` : '')
    )) return;
    const res = await send({ type: 'CLEAR_SYNCED' });
    setStatus(`Removed ${res?.removed ?? 0} synced.`);
    renderList();
    return;
  }
  if (!confirm(
    `None of these ${recs.length} have been synced — this is the only copy ` +
    `and deleting cannot be undone.

The listing photos are kept either way.

Delete anyway?`
  )) return;
  await send({ type: 'CLEAR_ALL' });
  setStatus('Cleared.');
  renderList();
});

// --- Wiring ----------------------------------------------------------------

$('back').addEventListener('click', closeAssociate);
$('arm').addEventListener('click', toggleArmed);
$('assoc-search').addEventListener('input', () => renderCandidates());
$('assoc-lot').addEventListener('change', async (e) => {
  if (!current) return;
  current.isLot = e.target.checked;
  await send({ type: 'SET_LOT', key: current.key, isLot: current.isLot });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STORE_CHANGED' && $('view-associate').hidden) renderList();
});

bindToActiveTab();
send({ type: 'GET_ARMED' }).then((res) => {
  armed = res?.armed || null;
  renderArmed();
});
renderList();

// Pull a fresh library on open when the stored copy has aged out, so the picker
// matches what is actually catalogued rather than whatever was current the last
// time anyone thought to refresh. Silent on failure — the stored copy still
// works, and an outage should not block a sweep.
cardIndex.refreshIfStale().then((res) => {
  if (!res.skipped) renderList();
});
