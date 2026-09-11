/**
 * utm-alias - short aliases in, correctly-grouped tagged URLs out.
 *
 * The problem this exists for is not shortening. It is that `utm_medium` is a
 * free-text field feeding a fixed set of pattern matches. GA4 assigns a session
 * to a default channel group by matching `utm_medium` against a closed list;
 * anything else lands in `(Unassigned)`. So `utm_medium=bio` - a perfectly
 * reasonable thing for a person to type - silently empties your channel report,
 * and nothing anywhere returns an error.
 *
 * The fix is to stop letting people type a medium. An author picks a PLACE
 * (where the link lives: a profile, a post, a README, a printed sheet) and the
 * table below expands it into a `(medium, content)` pair that GA4 can group.
 *
 * Everything here is pure: strings in, object out. No fetch, no Response, no
 * environment. That matters more than it sounds - clicking a real link to test
 * one injects a fake session into the very analytics property your report
 * reads, so a test suite that touches the network corrupts the thing it is
 * checking.
 *
 * @see https://support.google.com/analytics/answer/9756891
 */

/**
 * Place -> (utm_medium, utm_content).
 *
 * `medium: null` means "decide from the source": a link in a LinkedIn profile
 * is Organic Social, the same link in an npm README is Referral, because npm is
 * a real site referring someone onward.
 *
 * `print` and `doc` map to media GA4 does NOT group, and that is deliberate.
 * There is no default channel for a sheet of paper or for a document you
 * emailed a client. Forcing either into `referral` so the report looks tidy
 * would misstate where the visit came from. One honest `(Unassigned)` row is
 * readable; one dishonest `Referral` row is not.
 *
 * `checkPlaces` lists exactly which places do this, so the deliberate ones stay
 * visible and an accidental one stands out.
 */
export const PLACES = Object.freeze({
  bio: { medium: null, content: 'bio' },
  post: { medium: 'social', content: 'post' },
  video: { medium: 'video', content: 'video' },
  share: { medium: 'social', content: 'share' },
  email: { medium: 'email', content: 'newsletter' },
  readme: { medium: 'referral', content: 'readme' },
  print: { medium: 'print', content: 'print' },
  doc: { medium: 'document', content: 'doc' },
})

/** Sources that are social networks. Decides the medium for `bio`. */
export const SOCIAL_SOURCES = Object.freeze([
  'facebook', 'instagram', 'linkedin', 'tiktok', 'x', 'threads',
  'youtube', 'pinterest', 'reddit', 'zalo', 'telegram', 'whatsapp',
])

/**
 * Media GA4 groups into a named default channel, as documented.
 *
 * Used by `checkPlaces` so a custom place table cannot quietly introduce a
 * medium that lands in `(Unassigned)` without the author meaning it to.
 */
export const GROUPED_MEDIA = Object.freeze([
  'social', 'social-network', 'social-media', 'sm', 'social network', 'social media',
  'email', 'e-mail', 'e_mail', 'e mail',
  'referral', 'app', 'link',
  'affiliate', 'audio', 'sms', 'push', 'mobile', 'notification',
  'cpc', 'ppc', 'paid', 'display', 'banner', 'expandable', 'interstitial', 'cpm',
])

const SEGMENT = /^[a-z0-9]+$/
const ITEM = /^[a-z0-9-]{1,64}$/

/** A medium containing "video" is grouped by regex rather than by exact match. */
function isGrouped(medium) {
  return GROUPED_MEDIA.includes(medium) || /video/.test(medium)
}

/**
 * Build a resolver bound to your own destination, source and campaign tables.
 *
 * Destinations and campaigns are yours by definition. Sources default to the
 * common set and can be extended - an npm README and a GitHub repo are real
 * surfaces for some projects and meaningless for others.
 *
 * @param {object} config
 * @param {Record<string,string>} config.destinations  code -> path, e.g. `{ bl: '/blog/' }`
 * @param {Record<string,string>} [config.sources]     code -> utm_source
 * @param {Record<string,string>} [config.campaigns]   code -> utm_campaign
 * @param {Record<string,{medium: string|null, content: string}>} [config.places]
 * @param {string[]} [config.socialSources]  sources treated as social for `bio`
 * @param {string|null} [config.testCode]  alias code that resolves with NO parameters
 */
export function createResolver(config) {
  const destinations = config.destinations
  if (!destinations || Object.keys(destinations).length === 0) {
    throw new Error('utm-alias: config.destinations is required and must not be empty')
  }

  const sources = config.sources ?? DEFAULT_SOURCES
  const campaigns = config.campaigns ?? {}
  const places = config.places ?? PLACES
  const social = new Set(config.socialSources ?? SOCIAL_SOURCES)
  const testCode = config.testCode === undefined ? 'zz' : config.testCode

  // Every code lands in an alias segment, and segments are split on "-" and
  // matched against SEGMENT. A code the parser can never produce is worse than
  // a missing one: `sources: { 'my-src': ... }` builds fine, and then
  // `hm-my-src-post` fails with `source "my" is not in the table. Allowed:
  // my-src` - an error naming a code that cannot be used. Caught here instead,
  // at the one moment it is still cheap to fix.
  for (const [label, table] of [
    ['destination', destinations],
    ['source', sources],
    ['campaign', campaigns],
    ['place', places],
  ]) {
    for (const code of Object.keys(table)) {
      if (!SEGMENT.test(code)) {
        throw new Error(
          `utm-alias: ${label} code "${code}" cannot appear in an alias. ` +
            'Codes may contain lowercase letters and digits only, with no "-", ' +
            'because "-" separates alias segments.'
        )
      }
    }
  }

  if (testCode !== null && !SEGMENT.test(testCode)) {
    throw new Error(`utm-alias: testCode "${testCode}" may contain lowercase letters and digits only`)
  }

  for (const [code, path] of Object.entries(destinations)) {
    if (!path.startsWith('/')) {
      throw new Error(`utm-alias: destination "${code}" must be a path starting with "/", got "${path}"`)
    }
  }

  /**
   * @param {string} alias  e.g. "bl-li-post" or "bl-li-post-launch"
   * @param {string|null} [item]  appended to utm_content, e.g. a package or slug name
   */
  function resolve(alias, item = null) {
    if (typeof alias !== 'string' || alias === '') return fail('empty')

    const parts = alias.split('-')
    if (parts.length < 3 || parts.length > 4) return fail('segments', { count: parts.length })
    if (!parts.every((p) => SEGMENT.test(p))) return fail('charset')

    const [dCode, sCode, pCode, cCode] = parts

    const path = destinations[dCode]
    if (!path) return fail('destination', { code: dCode, allowed: Object.keys(destinations) })

    if (!(sCode in sources) && sCode !== testCode) {
      return fail('source', { code: sCode, allowed: Object.keys(sources) })
    }
    const place = places[pCode]
    if (!place) return fail('place', { code: pCode, allowed: Object.keys(places) })

    if (cCode !== undefined && !(cCode in campaigns)) {
      return fail('campaign', { code: cCode, allowed: Object.keys(campaigns) })
    }
    if (item != null && !ITEM.test(item)) return fail('item', { value: item })

    // The test code resolves to the right destination with NO parameters at all,
    // so checking a live link never reaches the analytics property. Without one,
    // every manual check is a fake session in the numbers you report on.
    if (sCode === testCode) return { ok: true, path, params: {}, test: true }

    const medium = place.medium ?? (social.has(sources[sCode]) ? 'social' : 'referral')
    const content = item ? `${place.content}-${item}` : place.content

    const params = {
      utm_source: sources[sCode],
      utm_medium: medium,
      utm_content: content,
    }
    if (cCode !== undefined) params.utm_campaign = campaigns[cCode]

    return { ok: true, path, params, test: false }
  }

  /** Resolve straight to an absolute URL. Returns null when the alias is invalid. */
  function resolveUrl(origin, alias, item = null) {
    const r = resolve(alias, item)
    return r.ok ? buildUrl(origin, r.path, r.params) : null
  }

  return { resolve, resolveUrl, destinations, sources, campaigns, places, testCode }
}

function fail(reason, detail = {}) {
  return { ok: false, reason, ...detail }
}

/** A starting source table. Extend it rather than replacing it. */
export const DEFAULT_SOURCES = Object.freeze({
  fb: 'facebook',
  ig: 'instagram',
  li: 'linkedin',
  tt: 'tiktok',
  tw: 'x',
  yt: 'youtube',
  za: 'zalo',
  tg: 'telegram',
  em: 'newsletter',
  qr: 'qr',
  dc: 'document',
})

/**
 * Absolute destination URL.
 *
 * Uses URLSearchParams rather than string concatenation, and that is not a
 * style preference. A tagged URL usually ends up inside another URL's query -
 * `sharer.php?u=<your url>` - and if it is pasted in raw, the receiving service
 * reads your `&utm_medium=` as one of ITS OWN parameters and drops it. The share
 * still works, the link still resolves, and half the parameters are gone with
 * nothing reporting an error.
 */
export function buildUrl(origin, path, params) {
  const u = new URL(path, origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * Put a tagged URL inside another URL's query string, encoded correctly.
 *
 * `tagShareLink('https://www.facebook.com/sharer/sharer.php?u=https://site.com/a/', 'u', tagged)`
 *
 * @param {string} shareHref  the share endpoint, with the target already in it
 * @param {string} key  which query parameter holds the target (`u`, `url`, ...)
 * @param {(target: string) => string} tag  returns the tagged version of the target
 */
export function tagShareLink(shareHref, key, tag) {
  const href = new URL(shareHref)
  const target = href.searchParams.get(key)
  if (!target) return shareHref
  href.searchParams.set(key, tag(target))
  return href.toString()
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a code point.
 *
 * Written for Cloudflare Workers Analytics Engine, whose index limit is 96
 * BYTES. `slice(0, 96)` is 96 characters, and the two are the same only while
 * your input is ASCII. Aliases are; malformed paths are not, and an oversized
 * data point is dropped with no error - so the malformed links you most want to
 * see are exactly the ones that vanish from the counter.
 */
export function truncateBytes(value, maxBytes = 96) {
  const enc = new TextEncoder()
  if (enc.encode(value).length <= maxBytes) return value

  let s = value
  while (s.length > 0 && enc.encode(s).length > maxBytes) s = s.slice(0, -1)
  return s
}

/**
 * Check a place table for media GA4 will not group.
 *
 * Returns one entry per place whose medium falls into `(Unassigned)`. An empty
 * array means every place maps to a named channel.
 *
 * This reports rather than throws, because landing in `(Unassigned)` is
 * sometimes the honest answer - `doc` in the default table does it on purpose.
 * What you want is to know which ones, not to be stopped.
 */
export function checkPlaces(places = PLACES) {
  const out = []
  for (const [code, place] of Object.entries(places)) {
    if (place.medium === null) continue // decided from the source, always grouped
    if (!isGrouped(place.medium)) out.push({ place: code, medium: place.medium })
  }
  return out
}

/**
 * Human-readable explanation of a failed resolve, listing what IS allowed.
 *
 * Saying `code "dv" is not in the table` without saying what the table holds
 * sends the reader off to look it up, which is most of the cost of the error.
 */
export function explain(result) {
  if (result.ok) return 'ok'
  const list = (a) => (a ? a.join(' ') : '')
  switch (result.reason) {
    case 'empty':
      return 'alias is empty'
    case 'segments':
      return `alias has ${result.count} segments, expected 3 or 4: <destination>-<source>-<place>[-<campaign>]`
    case 'charset':
      return 'each segment may contain lowercase letters and digits only'
    case 'destination':
      return `destination "${result.code}" is not in the table. Allowed: ${list(result.allowed)}`
    case 'source':
      return `source "${result.code}" is not in the table. Allowed: ${list(result.allowed)}`
    case 'place':
      return `place "${result.code}" is not in the table. Allowed: ${list(result.allowed)}`
    case 'campaign':
      return `campaign "${result.code}" is not declared. Declared: ${list(result.allowed) || '(none)'}`
    case 'item':
      return `item "${result.value}" may contain lowercase letters, digits and hyphens, up to 64 characters`
    default:
      return result.reason
  }
}
