// Exercises capture.js's price/currency/title/id parsing without a browser.
//
// The file is a content-script IIFE with no exports by design, so the test
// appends one line INSIDE the IIFE on a copy in memory. Nothing shipped
// changes; the alternative is duplicating the regexes into the test, which
// would test the copy rather than the code.
import fs from 'node:fs';

const src = fs.readFileSync('extension/content/capture.js', 'utf8');
const HOOK =
  '  globalThis.__cc = { SITES, money, idFromLastSegment, readPrice, TITLE_SOURCES, SITE };\n})();';
const patched = src.replace(/\}\)\(\);\s*$/, HOOK);
if (patched === src) throw new Error('could not find the IIFE close');

let fails = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// Loads the script as a given site. `headings` is the fixture scope() sees:
// it joins every selector into one query, so returning the fixture regardless
// of selector exercises exactly what it relies on — DOM order, the reject
// list, and the length guard.
function loadFor(hostname, pathname, headings = []) {
  globalThis.location = {
    hostname, pathname,
    origin: `https://${hostname}`,
    href: `https://${hostname}${pathname}`,
    search: '',
  };
  globalThis.document = {
    documentElement: { classList: { add() {}, remove() {} } },
    body: { dataset: {}, appendChild() {}, innerText: '' },
    querySelector: () => null,
    // Fixture elements. `chrome` marks one as living in the site's header,
    // nav or footer -- titleCandidates() excludes those structurally, which is
    // the part that has to keep working when the page is translated.
    querySelectorAll: () =>
      headings.map((h) => {
        const [text, where] = Array.isArray(h) ? h : [h, null];
        return {
          textContent: text,
          tagName: 'H2',
          className: '',
          closest: (sel) => (where === 'chrome' ? { sel } : null),
        };
      }),
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, addEventListener() {} }),
    title: '',
  };
  globalThis.chrome = { runtime: { sendMessage: async () => null, onMessage: { addListener() {} } } };
  new Function(patched)();
  return globalThis.__cc;
}

const NK = loadFor('neokyo.com', '/en/product/mercari/m12345678901');
const { SITES, idFromLastSegment } = NK;
const mus = SITES['www.mercari.com'];
const nk = SITES['neokyo.com'];

console.log('--- minor units ---');
eq('USD $12.34 -> 1234 cents', mus.priceFrom('$12.34'), 1234);
eq('USD $1,299.00 -> 129900', mus.priceFrom('Buy now $1,299.00'), 129900);
eq('USD no price -> null', mus.priceFrom('Sold'), null);
eq('JPY 3399 Yen -> 3399 (spelled out)', nk.priceFrom('3399 Yen'), 3399);
eq('JPY 1,200 Yen with comma', nk.priceFrom('1,200 Yen'), 1200);
eq('JPY symbol form still works', nk.priceFrom('¥1,200'), 1200);
eq('JPY full-width ￥350', nk.priceFrom('￥350'), 350);
eq('JPY 1,200円', nk.priceFrom('1,200円 送料込み'), 1200);
eq('Neokyo USD conversion -> cents', nk.usdFrom('Approximately : US$ 21.07'), 2107);
eq('Neokyo USD absent -> null', nk.usdFrom('3399 Yen'), null);

console.log('--- the real Neokyo page, as photographed ---');
// Exact strings off a live product page. The unit is SPELLED OUT, which is
// what the first version missed entirely: it looked only for ¥ and 円, found
// neither, and fell through to the dollars with the yen left empty.
const PRICE_BLOCK = 'Item Price on Rakuma 3399 Yen Approximately : US$ 21.07';
eq('3399 Yen + US$ 21.07',
   NK.readPrice(PRICE_BLOCK), { price: 3399, currency: 'JPY', priceUsd: 2107 });

// The header carries a points balance and a currency selector. Neither may be
// mistaken for the price when the whole page is searched.
const WHOLE_PAGE =
  'English $ USD 13:49 JST 233 0 0 My account ' +
  'Stray Kids Hyunjin KMS Rakuten Store Bonus ' + PRICE_BLOCK;
eq('whole-page read still finds the real price',
   NK.readPrice(null, WHOLE_PAGE), { price: 3399, currency: 'JPY', priceUsd: 2107 });
eq('header points are not a price', NK.readPrice('233 0 0').price, null);
eq('"$ USD" selector is not a price', NK.readPrice('English $ USD').price, null);

console.log('--- currency follows the page, not the marketplace ---');
eq('yen shown: JPY native, USD alongside',
   NK.readPrice('¥1,200 ($8.21)'), { price: 1200, currency: 'JPY', priceUsd: 821 });
eq('USD only: the dollars ARE the price',
   NK.readPrice('$4.33'), { price: 433, currency: 'USD', priceUsd: null });
eq('neither: empty, still typed to the site',
   NK.readPrice('Add to cart'), { price: null, currency: 'JPY', priceUsd: null });

const MU = loadFor('www.mercari.com', '/us/item/m12345678901/');
eq('mercari stays USD', MU.readPrice('$4.33'), { price: 433, currency: 'USD', priceUsd: null });

console.log('--- title comes from a heading, not the page name ---');
const NK2 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  'Item Details',                                // the page's own name
  'Stray Kids Hyunjin KMS Rakuten Store Bonus',  // the listing
  'Item Price on Rakuma',
  'Purchase Request Form',
  ['About Neokyo', 'chrome'],                    // footer
]);
eq('takes the listing, not a section heading',
   NK2.TITLE_SOURCES.scope(), 'Stray Kids Hyunjin KMS Rakuten Store Bonus');

// The blocklist is English and the page can be machine-translated, so the
// ranking has to hold with every word replaced. Same page, translated back to
// the Japanese underneath it -- nothing here matches titleReject.
const NK_JA = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  '商品詳細',
  'Stray Kids ヒョンジン KMS 楽天ブックス 購入特典 トレカ',
  'ラクマでの商品価格',
  '購入リクエストフォーム',
  ['ネオキョウについて', 'chrome'],
]);
eq('works with the blocklist matching nothing',
   NK_JA.TITLE_SOURCES.scope(), 'Stray Kids ヒョンジン KMS 楽天ブックス 購入特典 トレカ');

// The footer heading that won once the blocklist had eliminated everything
// above it. Structure excludes it now, in any language.
const NK4 = loadFor('neokyo.com', '/en/product/x/abc123def456', [
  ['About Neokyo and our shopping service', 'chrome'],
]);
eq('footer text cannot win, however long',
   NK4.TITLE_SOURCES.scope(), null);

const NK3 = loadFor('neokyo.com', '/en/product/x/abc123def456', ['Item Details']);
eq('nothing usable -> null, so the chain falls through',
   NK3.TITLE_SOURCES.scope(), null);
eq('neokyo tries the heading scope first', nk.titleOrder, ['scope', 'og', 'doc', 'h1']);
eq('mercari has no scope, so h1 first', mus.titleOrder ?? ['h1', 'og', 'doc'], ['h1', 'og', 'doc']);

console.log('--- sold state ---');
eq('mercari tile badge', mus.tileSoldFrom('Sold'), true);
eq('mercari detail sold', mus.soldFrom('Item sold'), true);
eq('mercari description mentioning sold out', mus.soldFrom('sold out elsewhere'), false);
eq('neokyo sold out (en)', nk.soldFrom('Sold Out'), true);
eq('neokyo sold out (jp)', nk.soldFrom('売り切れ'), true);
eq('neokyo in stock', nk.soldFrom('Availability In stock'), false);
eq('neokyo out of stock', nk.soldFrom('Availability Out of stock'), true);

console.log('--- ids ---');
eq('mercari id', mus.idFrom('/us/item/m12345678901/'), 'm12345678901');
eq('neokyo rakuma hash id',
   idFromLastSegment('/en/product/rakuma/41885a3084a99635a6dabdf397fd084a'),
   '41885a3084a99635a6dabdf397fd084a');
eq('neokyo trailing slash', idFromLastSegment('/en/product/rakuma/abcd1234efgh/'), 'abcd1234efgh');
eq('rejects a nav link', idFromLastSegment('/en/about'), null);
eq('rejects a short segment', idFromLastSegment('/en/p/12'), null);
eq('rejects a wordy segment', idFromLastSegment('/en/search-results'), null);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
