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
        // [text, kind, fontSizePx, selectorItMatches].
        //
        // `kind: 'chrome'` puts the element inside the site's
        // header/nav/footer, which titleCandidates() excludes structurally --
        // the part that has to keep working when the page is machine-
        // translated and no English string matches anything. `kind:
        // 'translate'` gives it Neokyo's own seller-content marker.
        const [text, kind, px, inner] = Array.isArray(h) ? h : [h, null, 16, null];
        const marked = kind === 'translate' || kind === 'translate-wrapped';
        return {
          textContent: text,
          tagName: marked ? 'H6' : 'DIV',
          className: marked ? 'font-gothamRounded mb-0 translate' : '',
          // Chrome's page translation rewrites each translated text node as a
          // <font> wrapper, so a translated element HAS children -- but none
          // of them is a candidate the ranking could pick instead. `inner` is
          // the in-scope descendant, if any, and that is what decides.
          children: kind === 'translate-wrapped' ? [{ tagName: 'FONT' }] : [],
          querySelector: () => inner || null,
          __px: px ?? 16,
          closest: (sel) => (kind === 'chrome' ? { sel } : null),
          matches: (sel) => marked && sel.includes('.translate'),
        };
      }),
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, addEventListener() {} }),
    title: '',
  };
  globalThis.chrome = { runtime: { sendMessage: async () => null, onMessage: { addListener() {} } } };
  globalThis.getComputedStyle = (el) => ({ fontSize: `${el.__px ?? 16}px` });
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

// Ranking is by type size before length. This is the page as photographed:
// the price is the largest text on it, and the cookie banner's heading is
// longer than the listing name -- both beat the title on the old rules.
const NK5 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  ['This website uses cookies', 'chrome', 20],
  ['Buy items from online Japanese shops!', 'chrome', 12],
  ['Stray Kids Hyunjin KMS Rakuten Store Bonus', null, 20],
  ['3399 Yen', null, 28],
  ['Item Price on Rakuma', null, 20],
  ['Purchase Request Form', null, 20],
  ['Approximately : US$ 21.07', null, 14],
  ['Create a buy request', null, 16],
]);
eq('the price cannot win the ranking',
   NK5.TITLE_SOURCES.scope(), 'Stray Kids Hyunjin KMS Rakuten Store Bonus');

// Same page with every string translated away, so titleReject matches none of
// them and only the structure and the type sizes are left to go on.
const NK6 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  ['当サイトはCookieを使用しています', 'chrome', 20],
  ['Stray Kids ヒョンジン KMS 楽天ブックス 購入特典', null, 20],
  ['3399円', null, 28],
  ['ラクマでの商品価格', null, 20],
  ['購入リクエストフォーム', null, 20],
]);
eq('holds with nothing in English',
   NK6.TITLE_SOURCES.scope(), 'Stray Kids ヒョンジン KMS 楽天ブックス 購入特典');

// The page as it really is. From the source:
//   <h6 class="font-gothamRounded mb-0 translate">straykids ヒョンジン kms
//   樂star 店舗特典</h6>
// `translate` is Neokyo's marker for text it machine-translates -- seller
// content, not site furniture -- so it settles the question outright.
const NK7 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  ['This website uses cookies', 'chrome', 20],
  ['straykids ヒョンジン kms 樂star 店舗特典', 'translate', 16],
  ['3399 Yen', null, 28],
  ['Item Price on Rakuma', null, 20],
  ['Purchase Request Form', null, 20],
]);
eq('the marked heading wins even at the smallest type',
   NK7.TITLE_SOURCES.scope(), 'straykids ヒョンジン kms 樂star 店舗特典');

// A short title would be filtered out by the length floor if the marker did
// not exempt it. The floor exists to keep section headings out of an UNMARKED
// shortlist; it must never veto the site's own answer.
const NK8 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  ['トレカ', 'translate', 16],
  ['Purchase Request Form', null, 20],
]);
eq('a short marked title is still the title',
   NK8.TITLE_SOURCES.scope(), 'トレカ');

// Viewed with Chrome's page translation on -- which is how the page is
// actually being browsed, and how this went wrong. Translation rewrites each
// translated text node as a <font> wrapper, so the listing's own h6 gains an
// element child. Testing for "has children" dropped it, along with the
// `translate` marker on it, and left the shortlist to a category menu whose
// English text Chrome had not touched. The wrapper marks the SELLER's text;
// dropping the wrapped element is exactly backwards.
const NK9 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  ['Stray Kids Hyunjin KMS Rakuten Store Bonus', 'translate-wrapped', 16],
  ['Anime, Manga, TCG', null, 18],
  ['Japanese Fashion', null, 18],
  ['Online Shopping', null, 18],
  ['Multiple Stores', null, 18],
]);
eq('a Chrome-translated title is not discarded as a wrapper',
   NK9.TITLE_SOURCES.scope(), 'Stray Kids Hyunjin KMS Rakuten Store Bonus');

// The rule the wrapper test replaced still has to work: a container holding
// nothing but an in-scope element loses to the element inside it.
const INNER = { textContent: 'Stray Kids Hyunjin KMS Rakuten Store Bonus' };
const NK10 = loadFor('neokyo.com', '/en/product/rakuma/41885a3084a99635a6dabdf397fd084a', [
  ['Stray Kids Hyunjin KMS Rakuten Store Bonus', null, 30, INNER],
  ['Estimate Total Cost', null, 20],
]);
eq('a wrapper around the same text is still skipped',
   NK10.TITLE_SOURCES.scope(), 'Estimate Total Cost');
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
