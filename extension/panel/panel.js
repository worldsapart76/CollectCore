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
  img.src = rec.thumbnailUrl || '';
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
    ? 'Remove from this queue (CollectCore keeps it)'
    : 'Delete — NOT synced, this is the only copy';
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
  const todo = records.filter((r) => !(r.lines || []).length).length;
  $('empty').hidden = records.length > 0;
  $('list').replaceChildren(...records.map(row));

  await renderIndexStatus(todo);
}

function ago(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function renderIndexStatus(todo = null, note = '') {
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
    const cards = await cardIndex.search(query);
    $('assoc-chips').replaceChildren();
    $('assoc-summary').textContent = query
      ? `${cards.length} match "${query}"`
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

function renderLines() {
  const lines = current.lines || [];
  const wrap = $('assoc-lines');
  if (!lines.length) {
    wrap.replaceChildren();
    return;
  }
  const els = lines.map((line) => {
    const el = document.createElement('span');
    el.className = 'line';
    el.textContent = line.label;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'line-x';
    x.textContent = '×';
    x.title = 'Remove this card';
    x.addEventListener('click', async () => {
      await send({ type: 'UNASSOCIATE', key: current.key, cardId: line.cardId });
      current.lines = lines.filter((l) => l.cardId !== line.cardId);
      renderLines();
    });
    el.append(x);
    return el;
  });
  wrap.replaceChildren(...els);
}

async function associate(card) {
  if (!current) return;
  await send({
    type: 'ASSOCIATE',
    key: current.key,
    card: { id: card.id, label: cardIndex.cardLabel(card) },
  });
  current.lines = current.lines || [];
  if (!current.lines.some((l) => l.cardId === card.id)) {
    current.lines.push({
      lineType: 'card',
      cardId: card.id,
      label: cardIndex.cardLabel(card),
    });
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

  $('assoc-img').src = rec.thumbnailUrl || '';
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
    $('index-status').textContent = 'Import a card index first.';
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
    $('index-status').textContent = 'Nothing to sync.';
    return;
  }

  $('index-status').textContent = `Syncing ${captures.length}…`;
  const res = await apiFetch('/market/captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captures }),
  });

  if (!res.ok) {
    $('index-status').textContent =
      res.reason === 'signin' ? SIGNIN_HINT : `Sync failed: ${res.reason}`;
    return;
  }
  // Only now is the server a second copy, so only now is clearing safe.
  await send({ type: 'MARK_SYNCED', keys: captures.map((c) => c.key) });
  renderList();

  const d = res.data;
  $('index-status').textContent =
    `Synced ${d.received} — ${d.listings_new} new listings, ` +
    `${d.sightings_new} new sightings. Safe to clear synced.`;
});

$('refresh').addEventListener('click', () => refreshCards());
$('import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const saved = await cardIndex.save(payload);
    $('index-status').textContent = `Imported ${saved.count.toLocaleString()} cards.`;
  } catch (err) {
    $('index-status').textContent = `Import failed: ${err.message}`;
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
    $('index-status').textContent = 'Nothing to clear.';
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
    $('index-status').textContent = `Removed ${res?.removed ?? 0} synced.`;
    renderList();
    return;
  }
  if (!confirm(
    `None of these ${recs.length} have been synced — this is the only copy ` +
    `and deleting cannot be undone.

Delete anyway?`
  )) return;
  await send({ type: 'CLEAR_ALL' });
  $('index-status').textContent = 'Cleared.';
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
