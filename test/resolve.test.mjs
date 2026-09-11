import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createResolver,
  buildUrl,
  tagShareLink,
  truncateBytes,
  checkPlaces,
  explain,
  PLACES,
  GROUPED_MEDIA,
  DEFAULT_SOURCES,
} from '../src/index.js'

const go = createResolver({
  destinations: { hm: '/', bl: '/blog/', dv: '/developers/' },
  sources: { ...DEFAULT_SOURCES, np: 'npm', gh: 'github' },
  campaigns: { launch: 'product-launch' },
})

// --- the point of the library -------------------------------------------------

test('exactly two default places land in (Unassigned), and both do so on purpose', () => {
  // The library exists to stop `(Unassigned)` happening by ACCIDENT. Two places
  // reach it deliberately: there is no GA4 default channel for a sheet of paper
  // or for a document you emailed a client, and forcing either into `referral`
  // so the report looks tidy would misstate where the visit came from.
  //
  // If this list ever grows, a place was added that silently empties the
  // channel report - which is the exact failure the library is for.
  assert.deepEqual(checkPlaces(), [
    { place: 'print', medium: 'print' },
    { place: 'doc', medium: 'document' },
  ])
})

test('bio changes channel with the source, and both answers are right', () => {
  // A link in a LinkedIn profile is Organic Social. The same link in an npm
  // README is Referral, because npm is a real site referring someone onward.
  assert.equal(go.resolve('hm-li-bio').params.utm_medium, 'social')
  assert.equal(go.resolve('hm-np-bio').params.utm_medium, 'referral')
  assert.equal(go.resolve('hm-gh-bio').params.utm_medium, 'referral')
})

test('the test code resolves to the destination with NO parameters at all', () => {
  // Without this, every manual check of a live link is a fake session in the
  // analytics property the report reads.
  const r = go.resolve('dv-zz-readme', 'anything')
  assert.equal(r.ok, true)
  assert.equal(r.test, true)
  assert.deepEqual(r.params, {})
})

// --- resolving ----------------------------------------------------------------

test('three segments expand into three parameters', () => {
  assert.deepEqual(go.resolve('dv-np-readme'), {
    ok: true,
    path: '/developers/',
    params: { utm_source: 'npm', utm_medium: 'referral', utm_content: 'readme' },
    test: false,
  })
})

test('a fourth segment is the campaign', () => {
  assert.equal(go.resolve('bl-li-post-launch').params.utm_campaign, 'product-launch')
})

test('item is appended to utm_content, it does not replace it', () => {
  assert.equal(go.resolve('dv-np-readme', 'my-package').params.utm_content, 'readme-my-package')
})

test('unknown codes are refused, never guessed', () => {
  assert.equal(go.resolve('xx-np-readme').reason, 'destination')
  assert.equal(go.resolve('dv-zx-readme').reason, 'source')
  assert.equal(go.resolve('dv-np-nowhere').reason, 'place')
  assert.equal(go.resolve('dv-np-readme-nope').reason, 'campaign')
  assert.equal(go.resolve('dv-np').reason, 'segments')
  assert.equal(go.resolve('DV-np-readme').reason, 'charset')
  assert.equal(go.resolve('').reason, 'empty')
  assert.equal(go.resolve('dv-np-readme', 'has spaces').reason, 'item')
})

test('an error names what IS allowed, not only what is wrong', () => {
  const msg = explain(go.resolve('xx-np-readme'))
  assert.match(msg, /destination "xx"/)
  assert.match(msg, /hm bl dv/)
})

test('resolveUrl returns null rather than a half-built URL', () => {
  assert.equal(go.resolveUrl('https://example.com', 'xx-np-readme'), null)
  assert.equal(
    go.resolveUrl('https://example.com', 'bl-li-post'),
    'https://example.com/blog/?utm_source=linkedin&utm_medium=social&utm_content=post'
  )
})

// --- configuration is checked at build time, not at click time ----------------

test('a code the parser can never produce is refused in EVERY table', () => {
  // The alias separator is "-", so such a code breaks parsing for every alias
  // using it - at click time, on links already published.
  //
  // 0.1.0 checked destinations only. A hyphenated SOURCE built fine and then
  // failed at resolve time with `source "my" is not in the table. Allowed:
  // my-src`, an error naming a code that cannot be used.
  const d = { hm: '/' }
  assert.throws(() => createResolver({ destinations: { 'my-page': '/x/' } }), /destination code/)
  assert.throws(() => createResolver({ destinations: d, sources: { 'my-src': 'x' } }), /source code/)
  assert.throws(() => createResolver({ destinations: d, campaigns: { 'my-camp': 'x' } }), /campaign code/)
  assert.throws(
    () => createResolver({ destinations: d, places: { 'my-place': { medium: 'social', content: 'x' } } }),
    /place code/
  )
  assert.throws(() => createResolver({ destinations: d, testCode: 'no-pe' }), /testCode/)

  // Uppercase is equally unusable: the parser only accepts lowercase.
  assert.throws(() => createResolver({ destinations: { HM: '/' } }), /destination code/)
})

test('a destination that is not a path is refused', () => {
  assert.throws(
    () => createResolver({ destinations: { hm: 'https://example.com/' } }),
    /must be a path/
  )
})

test('an empty destination table is refused', () => {
  assert.throws(() => createResolver({ destinations: {} }), /required/)
})

test('checkPlaces flags a custom place GA4 cannot group', () => {
  const found = checkPlaces({ newsletter: { medium: 'bulletin', content: 'x' } })
  assert.deepEqual(found, [{ place: 'newsletter', medium: 'bulletin' }])
})

test('a medium containing "video" is grouped, because GA4 matches it by regex', () => {
  assert.deepEqual(checkPlaces({ a: { medium: 'video', content: 'v' } }), [])
  assert.deepEqual(checkPlaces({ a: { medium: 'short-video', content: 'v' } }), [])
})

// --- the encoding trap --------------------------------------------------------

test('tagShareLink encodes the target so the receiving service keeps every parameter', () => {
  // Pasted in raw, `&utm_medium=` is read as a parameter of sharer.php and
  // dropped. The share still works and half the tags are gone, silently.
  const href = tagShareLink(
    'https://www.facebook.com/sharer/sharer.php?u=https://site.com/a/',
    'u',
    (t) => `${t}?utm_source=facebook&utm_medium=social&utm_content=share`
  )

  const outer = new URL(href)
  assert.deepEqual([...outer.searchParams.keys()], ['u'], 'the share endpoint must see ONE parameter')

  const inner = new URL(outer.searchParams.get('u'))
  assert.deepEqual(
    [...inner.searchParams.keys()],
    ['utm_source', 'utm_medium', 'utm_content'],
    'all three tags must survive inside the target'
  )
})

test('tagShareLink leaves a share link alone when the target is missing', () => {
  const href = 'https://example.com/share?something=else'
  assert.equal(tagShareLink(href, 'u', (t) => t), href)
})

// --- byte limits --------------------------------------------------------------

test('truncateBytes counts BYTES, not characters', () => {
  const enc = new TextEncoder()

  assert.equal(truncateBytes('bl-li-post'), 'bl-li-post', 'short input passes through untouched')

  // Latin-1 and above take 2-4 bytes per character, so 96 characters can be
  // nearly 300 bytes. Analytics Engine drops an oversized index with no error.
  const wide = 'báo-cáo-năng-lực-số-quý-ba'.repeat(6)
  assert.ok(enc.encode(wide).length > wide.length, 'the fixture must really be multi-byte')
  assert.ok(enc.encode(truncateBytes(wide)).length <= 96)
  assert.ok(!truncateBytes(wide).includes('�'), 'must not split a code point')
})

test('buildUrl does not add a second redirect hop', () => {
  // The path carries its own trailing slash, so hosts that canonicalise to one
  // do not answer with another redirect after the parameters are attached.
  assert.equal(
    buildUrl('https://example.com', '/blog/', { utm_source: 'x' }),
    'https://example.com/blog/?utm_source=x'
  )
})

// --- the tables themselves ----------------------------------------------------

test('every grouped medium is lowercase and free of stray whitespace', () => {
  for (const m of GROUPED_MEDIA) {
    assert.equal(m, m.toLowerCase().trim(), `"${m}" is not normalised`)
  }
})

test('PLACES and DEFAULT_SOURCES are frozen, so a caller cannot mutate shared state', () => {
  assert.throws(() => {
    PLACES.bio = null
  }, TypeError)
  assert.throws(() => {
    DEFAULT_SOURCES.li = 'nope'
  }, TypeError)
})
