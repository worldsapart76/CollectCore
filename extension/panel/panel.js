// Side panel: session list of captures, plus JSON export.
//
// Read-only against the store — the service worker is the single writer.
// Association, the lexicon pre-filter, and the mode toggle land here next;
// this slice exists to prove the capture loop end to end.

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');

// Opening this panel is what turns capture on; closing it turns capture off.
// The port exists so the service worker can observe that lifetime — its
// onDisconnect is the only reliable signal that the panel went away.
//
// Bound to the tab that was active when the panel opened, and deliberately not
// re-bound on tab switches: other tabs stay clean unless activated on purpose.
async function bindToActiveTab() {
  const port = chrome.runtime.connect({ name: 'panel' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) port.postMessage({ type: 'PANEL_INIT', tabId: tab.id });
}

bindToActiveTab();

const usd = (cents) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;

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
  meta.append(price(rec), state(rec));
  if (rec.itemCondition) meta.append(tag(rec.itemCondition));
  if (rec.suspectedLot) meta.append(tag('possible lot', 'warn'));
  if (rec.viaFallback) meta.append(tag('DOM fallback', 'warn'));
  if (rec.sightings?.length > 1) {
    meta.append(tag(`seen ${rec.sightings.length}×`));
  }

  const open = document.createElement('a');
  open.className = 'open';
  open.href = rec.listingUrl;
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.textContent = 'Open listing ↗';

  body.append(name, meta, open);
  li.append(img, body);
  return li;
}

function price(rec) {
  const el = document.createElement('span');
  el.className = 'price';
  el.textContent = usd(rec.priceCents);
  return el;
}

function state(rec) {
  const el = document.createElement('span');
  const sold = rec.listingState === 'sold';
  el.className = `tag ${sold ? 'sold' : 'active'}`;
  el.textContent = sold ? 'sold' : 'active';
  el.title = `status: ${rec.rawStatus}`;
  return el;
}

function tag(text, variant = '') {
  const el = document.createElement('span');
  el.className = `tag ${variant}`;
  el.textContent = text;
  return el;
}

async function render() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_ALL' });
  const records = (res?.records || []).sort((a, b) =>
    b.capturedAt.localeCompare(a.capturedAt)
  );

  countEl.textContent = String(records.length);
  emptyEl.hidden = records.length > 0;

  listEl.replaceChildren(...records.map(row));
}

document.getElementById('export').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'GET_ALL' });
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

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Delete every captured listing? This cannot be undone.')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
  render();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STORE_CHANGED') render();
});

render();
