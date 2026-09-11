export interface Place {
  /** `null` means "decide from the source": social for a social source, referral otherwise. */
  medium: string | null
  content: string
}

export interface ResolverConfig {
  /** Code -> path, e.g. `{ bl: '/blog/' }`. Codes must not contain `-`; paths must start with `/`. */
  destinations: Record<string, string>
  /** Code -> `utm_source`. Defaults to {@link DEFAULT_SOURCES}. */
  sources?: Record<string, string>
  /** Code -> `utm_campaign`. Empty by default; an undeclared campaign code is refused. */
  campaigns?: Record<string, string>
  /** Place table. Defaults to {@link PLACES}. */
  places?: Record<string, Place>
  /** `utm_source` values treated as social when a place has `medium: null`. */
  socialSources?: string[]
  /** Source code resolving to the destination with NO parameters. Defaults to `'zz'`; `null` disables. */
  testCode?: string | null
}

export type ResolveFailure =
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'segments'; count: number }
  | { ok: false; reason: 'charset' }
  | { ok: false; reason: 'destination' | 'source' | 'place' | 'campaign'; code: string; allowed: string[] }
  | { ok: false; reason: 'item'; value: string }

export interface ResolveSuccess {
  ok: true
  path: string
  params: Record<string, string>
  /** True when the alias used the test code, in which case `params` is empty. */
  test: boolean
}

export type ResolveResult = ResolveSuccess | ResolveFailure

export interface Resolver {
  resolve(alias: string, item?: string | null): ResolveResult
  /** Absolute URL, or `null` when the alias is invalid. */
  resolveUrl(origin: string, alias: string, item?: string | null): string | null
  readonly destinations: Record<string, string>
  readonly sources: Record<string, string>
  readonly campaigns: Record<string, string>
  readonly places: Record<string, Place>
  readonly testCode: string | null
}

export declare const PLACES: Readonly<Record<string, Place>>
export declare const DEFAULT_SOURCES: Readonly<Record<string, string>>
export declare const SOCIAL_SOURCES: readonly string[]
export declare const GROUPED_MEDIA: readonly string[]

/** Throws when the configuration would produce aliases that cannot be parsed. */
export declare function createResolver(config: ResolverConfig): Resolver

export declare function buildUrl(
  origin: string,
  path: string,
  params: Record<string, string>
): string

/** Put a tagged URL inside another URL's query string, encoded so it survives. */
export declare function tagShareLink(
  shareHref: string,
  key: string,
  tag: (target: string) => string
): string

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export declare function truncateBytes(value: string, maxBytes?: number): string

/** Places whose medium GA4 will not group. Empty means every place maps to a named channel. */
export declare function checkPlaces(
  places?: Record<string, Place>
): Array<{ place: string; medium: string }>

/** Human-readable explanation of a failed resolve, naming what IS allowed. */
export declare function explain(result: ResolveResult): string
