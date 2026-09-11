# @hecigolab/utm-alias

Short aliases in, tagged URLs out - with the guarantee that `utm_medium` is a value GA4 will actually group.

Zero dependencies. Pure functions. Runs on Cloudflare Workers, Node and the browser.

```bash
npm install @hecigolab/utm-alias
```

## The problem this solves is not shortening

`utm_medium` is a free-text field feeding a fixed set of pattern matches.

GA4 assigns a session to a default channel group by matching `utm_medium` against a closed list: `social`, `email`, `referral`, anything matching `.*video.*`, and a handful more. Anything else lands in `(Unassigned)`.

So this is a perfectly reasonable thing for a person to write:

```text
?utm_source=linkedin&utm_medium=bio
```

and it silently empties your channel report. The link works. The session is recorded. Nothing anywhere returns an error. You find out when someone opens the channel report months later.

**The fix is to stop letting people type a medium.** An author picks a *place* - where the link lives - and a table expands it into a `(medium, content)` pair that groups correctly.

```js
import { createResolver } from '@hecigolab/utm-alias'

const links = createResolver({
  destinations: { hm: '/', bl: '/blog/', dv: '/developers/' },
  campaigns: { launch: 'product-launch' },
})

links.resolveUrl('https://example.com', 'bl-li-post')
// https://example.com/blog/?utm_source=linkedin&utm_medium=social&utm_content=post

links.resolveUrl('https://example.com', 'dv-li-bio')
// https://example.com/developers/?utm_source=linkedin&utm_medium=social&utm_content=bio
```

An alias is `<destination>-<source>-<place>[-<campaign>]`. It is **computed, not minted** - nothing is stored, no API call is needed, so a script or a writing assistant can construct a correct link without asking anything.

## Places

| Place | `utm_medium` | GA4 channel |
|---|---|---|
| `bio` | `social` or `referral`, from the source | Organic Social / Referral |
| `post` | `social` | Organic Social |
| `video` | `video` | Organic Video |
| `share` | `social` | Organic Social |
| `email` | `email` | Email |
| `readme` | `referral` | Referral |
| `print` | `print` | **(Unassigned)**, on purpose |
| `doc` | `document` | **(Unassigned)**, on purpose |

`bio` resolves differently depending on where the profile is: a link in a LinkedIn bio is Organic Social, the same link in an npm README is Referral, because npm is a real site referring someone onward.

`print` and `doc` reach `(Unassigned)` deliberately. There is no GA4 default channel for a sheet of paper or for a document you emailed a client, and forcing either into `referral` so the report looks tidy would misstate where the visit came from. **One honest `(Unassigned)` row is readable; one dishonest `Referral` row is not.**

Bring your own table if you like - `checkPlaces` tells you which entries GA4 will not group, so a deliberate one stays visible and an accidental one stands out:

```js
import { checkPlaces } from '@hecigolab/utm-alias'

checkPlaces({ newsletter: { medium: 'bulletin', content: 'x' } })
// [{ place: 'newsletter', medium: 'bulletin' }]   <- would land in (Unassigned)
```

## Testing a live link without poisoning your own data

Clicking a real tagged link to check it injects a fake session into the very analytics property your report reads. Do it a few times a week and your test clicks become a visible share of your traffic.

Source code `zz` resolves to the right destination with **no parameters at all**:

```js
links.resolve('bl-zz-post')
// { ok: true, path: '/blog/', params: {}, test: true }
```

Every manual check of production goes through it. Change it with `testCode`, or set `null` to disable.

## Errors name what is allowed

```js
import { explain } from '@hecigolab/utm-alias'

explain(links.resolve('xx-li-post'))
// 'destination "xx" is not in the table. Allowed: hm bl dv'
```

Saying a code is wrong without saying what is right sends the reader off to look it up, which is most of the cost of the error.

Configuration is checked when the resolver is built, not when someone clicks:

```js
createResolver({ destinations: { 'my-page': '/x/' } })
// throws: destination code "my-page" contains "-", which separates alias segments
```

## Share buttons: the trap that eats half your parameters

Share endpoints take the target URL as a query parameter, and plenty of themes put it in unencoded:

```html
<a href="https://www.facebook.com/sharer/sharer.php?u=https://site.com/article/">
```

Append tags by string concatenation and you get this:

```text
sharer.php?u=https://site.com/article/?utm_source=facebook&utm_medium=social
```

Facebook reads that as **two** parameters of `sharer.php`: `u`, and an `utm_medium` it does not recognise and discards. The share still works, the link still resolves, and `utm_medium` and `utm_content` are gone. Half-broken, and nothing reports it.

```js
import { tagShareLink } from '@hecigolab/utm-alias'

tagShareLink(anchor.href, 'u', (target) => tagged(target))
// the target is re-encoded, so the endpoint sees exactly one parameter
```

Worth knowing while debugging this: every tool that shows you a URL **decodes it for readability**, and the decoded form of the correct version looks identical to the broken one. Read the raw attribute, or count the parameters the outer URL exposes.

## Byte limits

```js
import { truncateBytes } from '@hecigolab/utm-alias'

truncateBytes(alias, 96)
```

Written for Cloudflare Workers Analytics Engine, whose index limit is 96 **bytes**. `slice(0, 96)` is 96 *characters*, and the two agree only while the input is ASCII. Valid aliases are; malformed paths are not, and an oversized data point is dropped without an error - so the malformed links you most want to see are exactly the ones missing from the counter.

## On Cloudflare Workers

The library is the decision layer. Wiring it to a route is a few lines, and stays yours:

```js
import { createResolver } from '@hecigolab/utm-alias'

const links = createResolver({ destinations: { hm: '/', bl: '/blog/' } })

export default {
  fetch(request) {
    const url = new URL(request.url)
    const alias = url.pathname.replace(/^\/go\//, '').replace(/\/$/, '')
    const target = links.resolveUrl(url.origin, alias, url.searchParams.get('i'))

    // A bad alias goes to the bare homepage with NO parameters. Tagging it
    // `utm_source=badlink` would inject a source that does not exist into the
    // very dataset this layer exists to keep clean.
    return Response.redirect(target ?? url.origin, 302)
  },
}
```

Two choices in those lines worth stating outright:

**302, not 301.** A permanent redirect is cached by browsers forever, so changing a destination later never reaches anyone who clicked once. Being able to change the destination is the main reason to run this layer at all - a README published to a registry, a quote already sent, a QR code already printed are all immutable the moment they leave your hands.

**Do not index these paths.** `X-Robots-Tag: noindex, nofollow` on the redirect. An alias in a search index can become the landing page of an automated ad campaign, and then you are tagging a paid link, which splits your paid reporting in two.

## Prior art

Existing packages parse UTM parameters - `@segment/utm-params`, `utm-extractor`, `utmkeeper` and others read them off a URL. This one is on the writing side, and the part it adds is the guarantee that what you write is groupable.

## Provenance

Extracted from the link layer running on `hecigo.com` (Next.js on Cloudflare Workers) and on a second WordPress site, after a day of finding the ways it can fail quietly. The write-up of all seven, with measurements: [Bảy chỗ hỏng không kêu khi tự dựng lớp gắn tham số cho link](https://hecigo.com/blog/bay-cho-hong-khong-keu-khi-tu-dung-lop-gan-tham-so-cho-link/) (Vietnamese).

MIT. Issues and pull requests welcome at [github.com/hecigo/utm-alias](https://github.com/hecigo/utm-alias).
