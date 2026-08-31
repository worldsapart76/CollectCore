// bigThumb(): asking a CDN for a bigger rendition of an image it already has.
//
//   node tools/test_thumb_urls.mjs
//
// This had no coverage and shipped a silent 403. `bigThumb` was scoped to the
// mercdn.net HOST but not to the URL SHAPE, so it added `width=640` to Neokyo's
// Mercari-JP originals -- which carry a bare cache-buster and no dimensions at
// all, because they already are the full-size image. The result parsed, looked
// entirely ordinary, and could not load.
//
// background.js is a service-worker module and cannot be imported here, so the
// function is lifted out by source. That keeps the test on the shipped code
// rather than on a copy of it.
import fs from 'node:fs';

const src = fs.readFileSync('extension/background.js', 'utf8');
const fn = src.match(/^function bigThumb\(url\) \{[\s\S]*?\n\}/m);
if (!fn) throw new Error('could not find bigThumb in background.js');

const IMAGE_WIDTH = Number(src.match(/const IMAGE_WIDTH = (\d+)/)?.[1]);
if (!IMAGE_WIDTH) throw new Error('could not read IMAGE_WIDTH');
const bigThumb = new Function(`const IMAGE_WIDTH = ${IMAGE_WIDTH};` + fn[0] + '; return bigThumb;')();

let fails = 0;
function eq(label, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got  ${got}\n        want ${want}`);
}

console.log('--- only rewrite a dimension the URL already declares ---');
// The bug, exactly. Same host as a Mercari US thumbnail; no dimensions, because
// /item/detail/orig/ IS the original. URLSearchParams turned the bare token
// into `1787925462=` and appended width, and the CDN answered 403.
const JP_ORIG =
  'https://static.mercdn.net/item/detail/orig/photos/m47235147985_1.jpg?1787925462';
eq('a Mercari original is left exactly as found', bigThumb(JP_ORIG), JP_ORIG);
eq('so is one with no query at all',
   bigThumb('https://static.mercdn.net/item/detail/orig/photos/m1_1.jpg'),
   'https://static.mercdn.net/item/detail/orig/photos/m1_1.jpg');

console.log('\n--- where it IS declared, ask for more of it ---');
eq('width is raised and height dropped',
   bigThumb('https://static.mercdn.net/p/m228_1.jpg?1787769379&width=200&height=200'),
   'https://static.mercdn.net/p/m228_1.jpg?1787769379&width=640');
// Edited as a string, never re-serialised: the leading bare cache-buster must
// survive byte for byte, on a CDN already shown to be strict about it.
eq('the bare cache-buster survives untouched',
   bigThumb('https://static.mercdn.net/p/a.jpg?1787769379&width=200').includes('?1787769379&'),
   true);
eq('height first still leaves a clean query',
   bigThumb('https://static.mercdn.net/p/a.jpg?height=200&width=200'),
   'https://static.mercdn.net/p/a.jpg?width=640');
eq('width alone, no cache-buster',
   bigThumb('https://static.mercdn.net/p/a.jpg?width=200'),
   'https://static.mercdn.net/p/a.jpg?width=640');

console.log('\n--- other hosts are not Mercari and are not guessed at ---');
// Rakuma serves Neokyo's other listings. An unknown `width` there is at best
// ignored and at worst a cache miss -- and it is why those captures worked
// while the Mercari-JP ones did not.
eq('Rakuma is untouched',
   bigThumb('https://img.fril.jp/img/a/b_m.jpg?1234'),
   'https://img.fril.jp/img/a/b_m.jpg?1234');
eq('an unknown host is untouched',
   bigThumb('https://cdn.example.jp/x/9.jpg?width=200'),
   'https://cdn.example.jp/x/9.jpg?width=200');

console.log('\n--- eBay sizes in the filename, and only when it says so ---');
eq('s-l225 becomes s-l500',
   bigThumb('https://i.ebayimg.com/images/g/abc/s-l225.jpg'),
   'https://i.ebayimg.com/images/g/abc/s-l500.jpg');
// The same rule as the Mercari branch: no declared size, no rewrite.
eq('a URL with no size segment is left alone',
   bigThumb('https://i.ebayimg.com/images/g/abc/photo.jpg'),
   'https://i.ebayimg.com/images/g/abc/photo.jpg');

console.log('\n--- degenerate input ---');
eq('null in, null out', bigThumb(null), null);
eq('unparseable is returned as given', bigThumb('not a url'), 'not a url');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
