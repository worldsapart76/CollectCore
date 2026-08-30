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


console.log('--- eBay: "3 sold" on a LIVE tile is not a sale ---');
const EB = loadFor('www.ebay.com', '/itm/stray-kids-photocard/123456789012');
const eb = SITES['www.ebay.com'];
// The whole reason eBay cannot use a bare /sold/ test: an active listing
// advertises how many have gone, and reading that as a sale would file a live
// ask as a comp at the asking price.
eq('active tile: "3 sold"', eb.tileSoldFrom('$12.99 Buy It Now 3 sold'), false);
eq('active tile: "1,204 sold"', eb.tileSoldFrom('$8.50 1,204 sold'), false);
eq('active tile: watchers', eb.tileSoldFrom('$8.50 12 watchers'), false);
eq('sold tile states its date', eb.tileSoldFrom('$12.99 Sold  Sep 12, 2025'), true);
eq('sold tile, no comma', eb.tileSoldFrom('Sold Sep 12 2025'), true);

console.log('--- eBay: ended is not sold ---');
eq('detail: sold with a date', eb.soldFrom('Sold  Sep 12, 2025'), true);
eq('detail: this listing sold', eb.soldFrom('This listing sold on Sep 12'), true);
eq('detail: auction won', eb.soldFrom('Winning bid: US $18.50'), true);
// An auction that closed with no bids, or a listing pulled by its seller, sold
// for nothing. Treating either as a sale invents a comp out of an absence.
eq('detail: ended by seller', eb.soldFrom('This listing was ended by the seller'), false);
eq('detail: bidding ended', eb.soldFrom('Bidding has ended on this item'), false);
eq('detail: live listing', eb.soldFrom('Buy It Now  $12.99  3 sold'), false);

console.log('--- eBay: foreign currency is refused, not mislabelled ---');
eq('plain US price', eb.priceFrom('$12.99'), 1299);
eq('explicit US price', eb.priceFrom('US $12.99'), 1299);
eq('with shipping alongside', eb.priceFrom('$12.99 +$4.50 shipping'), 1299);
// Reading C $18.00 as eighteen US dollars is a silent ~30% error that looks
// entirely ordinary on screen.
eq('Canadian is refused', eb.priceFrom('C $18.00'), null);
eq('Australian is refused', eb.priceFrom('AU $24.00'), null);
eq('US wins when both appear', eb.priceFrom('C $18.00 (US $13.20)'), 1320);
eq('no price at all', eb.priceFrom('Buy It Now'), null);

console.log('--- eBay: ids survive the slug and the tracking tail ---');
eq('bare item path', eb.idFrom('/itm/123456789012'), '123456789012');
eq('with a title slug', eb.idFrom('/itm/stray-kids-hyunjin-photocard/123456789012'),
   '123456789012');
eq('absolute href with tracking',
   eb.idFrom('https://www.ebay.com/itm/123456789012?hash=item1c8&var=0&_trkparms=x'),
   '123456789012');
eq('canonical URL drops the tail', eb.urlFor('123456789012'),
   'https://www.ebay.com/itm/123456789012');
eq('a search link is not a listing', eb.idFrom('/sch/i.html?_nkw=photocard'), null);

console.log('--- eBay: the furniture welded onto a name ---');
// A title with "New Listing" or "Details about" on it matches nothing in the
// card index, and both come from eBay rather than from the seller.
eq('screen-reader prefix', eb.titleClean('Details about  Stray Kids Hyunjin PC'),
   'Stray Kids Hyunjin PC');
eq('new-listing flash', eb.titleClean('New ListingStray Kids Hyunjin PC'),
   'Stray Kids Hyunjin PC');
eq('link affordance suffix',
   eb.titleClean('Stray Kids Hyunjin PC Opens in a new window or tab'),
   'Stray Kids Hyunjin PC');
eq('an ordinary title is untouched', eb.titleClean('Stray Kids Hyunjin PC'),
   'Stray Kids Hyunjin PC');

const EB2 = loadFor('www.ebay.com', '/itm/123456789012', [
  ['Details about Stray Kids Hyunjin Rock Star Photocard', null, 28],
  ['Stray Kids Hyunjin Rock Star Photocard', 'translate', 24],
]);
eq('the bold span beats the h1 that wraps it',
   EB2.TITLE_SOURCES.scope(), 'Stray Kids Hyunjin Rock Star Photocard');

console.log('--- eBay: the site currency ---');
eq('dollars are the price, not a conversion',
   EB.readPrice('$12.99'), { price: 1299, currency: 'USD', priceUsd: null });
eq('nothing readable', EB.readPrice('Buy It Now'),
   { price: null, currency: 'USD', priceUsd: null });


console.log('--- eBay: the sale states its own date ---');
// A sold search returns months of sales in one sweep. Stamping them all with
// the capture time would make a March sale read as a day old, which is exactly
// what the grid colours staleness on.
eq('tile sold date', eb.soldDateFrom('$12.99 Sold  Sep 12, 2025'),
   '2025-09-12T00:00:00.000Z');
eq('abbreviated with a dot', eb.soldDateFrom('Sold Mar. 3, 2026'),
   '2026-03-03T00:00:00.000Z');
eq('spelled out in full', eb.soldDateFrom('Sold December 25, 2024'),
   '2024-12-25T00:00:00.000Z');
eq('a live listing has no sale date', eb.soldDateFrom('Buy It Now 3 sold'), null);
eq('a made-up month is refused', eb.soldDateFrom('Sold Foo 12, 2025'), null);
eq('other sites do not claim one', nk.soldDateFrom, undefined);


console.log('--- eBay: postage is per listing, and null is not free ---');
// A $6.00 card with $5.48 postage costs nearly twice a $6.00 card without, and
// no per-marketplace average can tell those apart.
eq('the listing page row', eb.shippingFrom('Shipping: US $5.48 USPS Ground Advantage'),
   548);
eq('the tile form', eb.shippingFrom('$12.99 +$4.50 shipping'), 450);
eq('estimated on a tile', eb.shippingFrom('$12.99 +$4.50 est. shipping'), 450);
// 0 and null are different answers: 0 switches the standing estimate off, null
// leaves it standing.
eq('free shipping is zero', eb.shippingFrom('Free shipping'), 0);
eq('free international', eb.shippingFrom('Free International Shipping'), 0);
eq('the label form of free', eb.shippingFrom('Shipping: Free'), 0);
eq('unread is null, not free', eb.shippingFrom('Buy It Now'), null);
// The guard on the label-scoped pattern: without it the read reaches across
// the page and returns the next dollar figure it can find.
eq('does not reach across the page for a price',
   eb.shippingFrom('Shipping and returns and payments and delivery and more $99.00'),
   null);
eq('the item price is not the postage', eb.shippingFrom('US $6.00 or Best Offer'), null);
eq('other sites do not claim one', nk.shippingFrom, undefined);


console.log('--- Pocamarket: three USD figures, one of them the price ---');
const PM = loadFor('pocamarket.com', '/search/detail/498832');
const pm = SITES['pocamarket.com'];
// The listing page reads, top to bottom:
//   Save 1.40 USD before price increases!
//   7.00 USD
//   Ship to United States from 12.00 USD
// Taking the first match buys the card for its discount; taking the largest
// buys it for the postage.
const PM_PAGE =
  'Album THIS & THAT THIS VER. Stray Kids | HYUNJIN ' +
  'Save 1.40 USD before price increases! 7.00 USD Upcoming Prices ' +
  'Shipping Information Ship to United States from 12.00 USD ' +
  'Same fee up to 40 items duties apply at shipping checkout';
eq('the price, not the discount and not the postage',
   PM.readPrice(null, PM_PAGE), { price: 700, currency: 'USD', priceUsd: null });
eq('the discount alone is not a price', pm.usdFrom('Save 1.40 USD'), null);
eq('the shipping estimate alone is not a price',
   pm.usdFrom('Ship to United States from 12.00 USD'), null);
eq('numbers come before the unit', pm.usdFrom('7.00 USD'), 700);

console.log('--- Pocamarket: won, if the display is ever switched ---');
// The currency follows the PAGE, not the marketplace row -- the same rule that
// made Neokyo work once its selector was set to USD.
eq('won suffix', pm.priceFrom('12,000\uc6d0'), 12000);
eq('won symbol', pm.priceFrom('\u20a912,000'), 12000);
eq('spelled out', pm.priceFrom('12,000 KRW'), 12000);
eq('KRW has no minor unit', pm.priceFrom('12,000 KRW'), 12000);
eq('dollars are not won', pm.priceFrom('7.00 USD'), null);
eq('won wins when both are shown',
   PM.readPrice('12,000\uc6d0 (7.00 USD)'),
   { price: 12000, currency: 'KRW', priceUsd: 700 });

console.log('--- Pocamarket: ids and URLs ---');
eq('detail id', pm.idFrom('/search/detail/498832'), '498832');
eq('absolute href', pm.idFrom('https://pocamarket.com/search/detail/498832'),
   '498832');
eq('canonical URL', pm.urlFor('498832'),
   'https://pocamarket.com/search/detail/498832');
eq('a search link is not a listing', pm.idFrom('/search?q=hyunjin'), null);

console.log('--- Pocamarket: the landing page behind the app frame ---');
// It renders as a mobile frame on desktop with the marketing page still in the
// DOM beside it, in display type -- so it wins the font-size ranking outright.
const PM2 = loadFor('pocamarket.com', '/search/detail/498832', [
  ['The Marketplace for K-Pop Photocards', null, 48],
  ['Collect Verified Photocards of Your Bias on Pocamarket.', null, 20],
  ['THIS & THAT THIS VER.', null, 18],
]);
eq('the landing headline cannot win',
   PM2.TITLE_SOURCES.scope(), 'THIS & THAT THIS VER.');
eq('and its subhead cannot either',
   PM2.TITLE_SOURCES.scope() === 'Collect Verified Photocards of Your Bias on Pocamarket.',
   false);
// Until the real name element is confirmed against a live page, every capture
// reports its shortlist rather than presenting a guess as an answer.
eq('the title is marked unverified', pm.titleUnverified, true);

console.log('--- Pocamarket: postage is per SHIPMENT, so it is not read ---');
// "Ship to United States from 12.00 USD -- same fee up to 40 items" is a box
// cost. Recording it per listing would charge $12 forty times.
eq('no per-listing shipping hook', pm.shippingFrom, undefined);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
