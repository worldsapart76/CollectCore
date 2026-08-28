// Side panel: capture list, and the associate view where a listing gets tied
// to catalog cards.
//
// Read-only against the observation store — the service worker is the single
// writer, reached by message.

import * as cardIndex from '../lib/cardIndex.js';
import { apiFetch, SIGNIN_HINT } from '../lib/api.js';

const $ = (id) => document.getElementById(id);
const usd = (cents) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);

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
  price.textContent = usd(rec.priceCents);
  meta.append(price, stateTag(rec));
  if (rec.itemCondition) meta.append(tag(rec.itemCondition));
  if (rec.isLot) meta.append(tag('lot', 'warn'));
  else if (rec.suspectedLot) meta.append(tag('possible lot?', 'warn'));
  if (rec.viaFallback) meta.append(tag('DOM fallback', 'warn'));
  if (rec.sightings?.length > 1) meta.append(tag(`seen ${rec.sightings.length}×`));

  const lines = rec.lines || [];
  const assoc = document.createElement('button');
  assoc.type = 'button';
  assoc.className = lines.length ? 'assoc assoc-done' : 'assoc assoc-todo';
  assoc.textContent = lines.length
    ? lines.map((l) => l.label).join(' + ')
    : 'Identify →';
  assoc.addEventListener('click', () => openAssociate(rec));

  body.append(name, meta, assoc);
  li.append(img, body);
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
  if (res.widened) bits.push('widened to avoid an empty result');
  if (res.lowConfidence) bits.push('no member matched — may not be your group');
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

  const facts = [usd(rec.priceCents)];
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
  const d = res.data;
  $('index-status').textContent =
    `Synced ${d.received} — ${d.listings_new} new listings, ` +
    `${d.sightings_new} new sightings.`;
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

$('clear').addEventListener('click', async () => {
  if (!confirm('Delete every captured listing? This cannot be undone.')) return;
  await send({ type: 'CLEAR_ALL' });
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
