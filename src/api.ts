/**
 * Thin client for the AtlasFetch HTTP API.
 *
 * Holds no data and makes no decisions about geometry — it forwards requests and
 * turns failures into sentences an assistant can act on. A raw "402" tells a
 * model nothing; "monthly allowance exhausted, resets at the start of the next
 * period" tells it to stop retrying and say so.
 */

import { VERSION } from './version.js'

const DEFAULT_BASE_URL = 'https://api.atlasfetch.xyz'

/**
 * Identifies this server to the API so adoption can be measured. The API keeps
 * only `atlasfetch-mcp/<version>` from it — never the rest, and never anything
 * about the user. See src/lib/clientId.ts in the API.
 */
export const USER_AGENT = `atlasfetch-mcp/${VERSION} (+https://github.com/atlasfetch-dev/atlasfetch-mcp)`

export function baseUrl(): string {
  return (process.env.ATLASFETCH_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * A failure the caller should be told about verbatim, not retried blindly.
 *
 * Whether a retry can help is said in the MESSAGE, in words, because that is
 * all an MCP client passes to the model: a tool result has no retry flag. Every
 * case in request() says either what to change or when trying again is worth
 * it. (Until 0.4.1 this class also carried a `retryable` boolean that nothing
 * ever read; it was removed so nobody trusts it.)
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let cachedDemoKey: string | null = null

/**
 * The key every request uses.
 *
 * `ATLASFETCH_API_KEY` if set; otherwise the shared public demo key, fetched
 * once. The demo key belongs to ONE communal account whose quota, rate limit
 * and single boundary set are pooled across every anonymous user on the
 * internet — fine for a first look, wrong for anything real. `usingDemoKey`
 * exists so every tool result can say so rather than letting someone build on
 * it unawares.
 */
export async function resolveKey(): Promise<string> {
  const configured = process.env.ATLASFETCH_API_KEY?.trim()
  if (configured) return configured

  if (cachedDemoKey) return cachedDemoKey

  const response = await fetch(`${baseUrl()}/demo/key`, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) {
    throw new ApiError(
      'No ATLASFETCH_API_KEY is configured and the public demo key could not be fetched. ' +
        'Create a key at https://atlasfetch.xyz/dashboard and set ATLASFETCH_API_KEY.',
      response.status,
    )
  }
  const body = (await response.json()) as { key?: string }
  if (!body.key) {
    throw new ApiError('The demo key endpoint returned no key.', 502)
  }
  cachedDemoKey = body.key
  return cachedDemoKey
}

export function usingDemoKey(): boolean {
  return !process.env.ATLASFETCH_API_KEY?.trim()
}

/** One line appended to every result while the shared key is in use. */
export const DEMO_KEY_NOTICE =
  'Note: using the shared public demo key. Its quota and rate limit are pooled across ' +
  'every anonymous user, so it is unsuitable for production. Create your own at ' +
  'https://atlasfetch.xyz/dashboard and set ATLASFETCH_API_KEY.'

/**
 * The API's sentence, its machine-readable `code` where it sends one (routes,
 * geocoding), and its per-field `details`. "Validation error" alone tells a
 * model nothing; "vehicle.heightMeters: Too big: expected number to be <=10"
 * tells it what to change.
 */
async function readError(response: Response): Promise<{ detail: string; code?: string }> {
  try {
    const body = (await response.json()) as { error?: string; code?: string; details?: Record<string, string[] | string> }
    const fields = Object.entries(body.details ?? {})
      .map(([field, problems]) => `${field}: ${[problems].flat().join(', ')}`)
    const detail = body.error ?? response.statusText
    return { detail: fields.length > 0 ? `${detail} (${fields.join('; ')})` : detail, code: body.code }
  } catch {
    return { detail: response.statusText }
  }
}

/**
 * Perform a request against the API, mapping each documented failure to an
 * explanation. Status codes come from https://api.atlasfetch.xyz/openapi.json
 */
export async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const key = await resolveKey()
  const url = new URL(`${baseUrl()}${path}`)
  for (const [name, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, value)
  }

  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      'User-Agent': USER_AGENT,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (response.ok) return (await response.json()) as T

  const { detail, code } = await readError(response)
  switch (response.status) {
    case 400:
      throw new ApiError(`The request was rejected: ${detail}`, 400)
    case 401:
      throw new ApiError(
        // Since 2026-10-12 keys can be shown again in the dashboard, and every key
        // made before then was revoked. Someone holding an old key is told to copy
        // a live one, not to start over.
        `The API key was rejected (${detail}). Copy a live key from ` +
          'https://atlasfetch.xyz/dashboard, where keys can be shown at any time, and set it as ' +
          'ATLASFETCH_API_KEY. Keys made before 12 October 2026 were revoked.',
        401,
      )
    case 402:
      throw new ApiError(
        `The monthly lookup allowance is exhausted (${detail}). It resets at the start of the next ` +
          'billing period; retrying before then will fail the same way.',
        402,
      )
    case 403:
      // Not every 403 is about the plan. An avoid set the key cannot read is a
      // setup step the user can fix in a minute, and nothing was billed.
      if (code === 'avoid_set_unavailable') {
        throw new ApiError(
          /does not exist/.test(detail)
            ? `${detail} Nothing was billed. Check the name with list_boundary_sets, or leave it out of avoidSets.`
            : `${detail} Nothing was billed. At https://atlasfetch.xyz/dashboard, switch the set on and ` +
                'grant it to the key this server uses, or leave it out of avoidSets.',
          403,
        )
      }
      throw new ApiError(`The current plan does not allow this, or a cap was exceeded: ${detail}`, 403)
    case 404:
      throw new ApiError(detail || 'Not found.', 404)
    case 422:
      // Routing only: the request was valid and was attempted, so it IS billed.
      // Retrying the identical route cannot succeed; the locations must move.
      throw new ApiError(
        `${detail} This one was billed, because the route was attempted. Retrying the same ` +
          'locations will fail the same way — move them nearer a road, or closer together.',
        422,
      )
    case 409:
      throw new ApiError(detail || 'Conflict — something of that name already exists.', 409)
    case 429: {
      const retryAfter = response.headers.get('retry-after')
      throw new ApiError(
        `Rate limited${retryAfter ? `; retry after ${retryAfter}s` : ''}. The limit is per key, per second. ` +
          'Nothing was billed.',
        429,
      )
    }
    case 503:
      throw new ApiError(
        `The routing engine is not answering right now (${detail}). Nothing was billed. ` +
          'Lookups are unaffected; try the route again in a few minutes.',
        503,
      )
    default:
      throw new ApiError(
        response.status >= 500
          ? `AtlasFetch had a problem on its side (${response.status}: ${detail}). Trying once more ` +
              'in a moment may work; if it keeps failing, it is not something the request can fix.'
          : `AtlasFetch returned ${response.status}: ${detail}`,
        response.status,
      )
  }
}

// ── Response shapes ──────────────────────────────────────────────────────────
// Only what the tools actually read. The API is the authority on the rest.

export interface LayerHit {
  code: string | null
  name: string
}

/**
 * One street answer. The lookup returns exactly three of these when `street` is
 * asked for — for 5 m, 20 m and unlimited, in that order.
 */
export interface StreetAnswer {
  /** 5, 20, or null for unlimited. */
  radiusMeters: number | null
  /** A string, never a number: `44A`, `12-14`. Only when an address matched. */
  streetNumber: string | null
  streetName: string | null
  postcode: string | null
  distanceMeters: number | null
  /** Only when streetgeom was asked for: the named street, trimmed to about 250 m. */
  geometry?: string | { type: string; coordinates: number[][] } | null
}

export interface LookupResponse {
  /**
   * `country`, `region` and `municipal` are a single hit or null; `street` is
   * three answers, or null when there is no street data for the point's country.
   * Those two nulls mean different things — see the tool description.
   */
  base: Record<string, LayerHit | StreetAnswer[] | null>
  sets: Record<string, Array<{ name: string; properties?: unknown }>>
  encoded?: { h3?: string; pluscode?: string }
  /** Always present, empty or not. Per-set problems appear here WITH a 200. */
  errors: Array<{ type: 'access' | 'usage'; message: string }>
}

// ── Geocoding ────────────────────────────────────────────────────────────────
// POST /geocode, spec 1.5.0. One best guess per address, or null.

export interface GeocodeResult {
  lat: number
  lng: number
  /** address, interpolated, street or locality: how much of the address was found. */
  precision: 'address' | 'interpolated' | 'intersection' | 'site' | 'street' | 'locality'
  /** 0 to 1. Ranks answers; not a probability. */
  confidence: number
  /** A same-named street elsewhere scored about as well. */
  ambiguous: boolean
  /** What was used, spelt as the data spells it. */
  matched: {
    housenumber?: string
    street?: string
    /** A corner's second street; only with precision intersection. */
    crossStreet?: string
    /** A named site (mall, office park, complex, hospital…) as OpenStreetMap names it. */
    site?: string
    locality?: string
    region?: string
    country?: string
  }
  /** Parts of the address that matched nothing. */
  unmatched: string[]
  sets?: Record<string, Array<{ name: string; properties?: unknown }>>
  base?: Record<string, LayerHit | null>
  geometry?: string | { type: string; coordinates: number[][] } | null
}

export interface GeocodeResponse {
  result: GeocodeResult | null
  errors: Array<{ type: string; message: string }>
}

export interface StoredBoundary {
  id: string
  set?: string
  name: string
  properties?: unknown
  pointCount?: number
}

// ── Routing ──────────────────────────────────────────────────────────────────
// POST /route, spec 1.3.0. Metres and seconds throughout, and durations are
// free-flow: no live or historical traffic.

export interface RouteStep {
  /** depart, arrive, continue, turn-left, …, roundabout, ferry, other. */
  maneuver: string
  instruction: string
  streetNames: string[]
  distanceMeters: number
  durationSeconds: number
}

export interface RouteLeg {
  distanceMeters: number
  durationSeconds: number
  /** Only when `steps: true` was asked for. */
  steps?: RouteStep[]
}

export interface Route {
  mode: string
  distanceMeters: number
  durationSeconds: number
  legs: RouteLeg[]
  /** Only when `geometry` was asked for; omitted by default on purpose. */
  geometry?: string | { type: string; coordinates: number[][] }
  /** Only when `exposure.sets` was asked for. */
  exposure?: Array<{ set: string; zone: string; properties?: unknown; metersInside: number }>
}

export interface RouteResponse {
  route: Route
  alternatives?: Route[]
  /** The SNAPPED locations, and how far each moved to reach a road. */
  locations: Array<{ lat: number; lng: number; snapDistanceMeters: number }>
  avoid?: {
    applied: Array<{ set: string; zone: string }>
    /** A zone holding one of the locations cannot be avoided for that route. */
    skipped: Array<{ set: string; zone: string; reason: string; locationIndex?: number }>
  }
  warnings: Array<{ type: string; message?: string }>
  errors: Array<{ type: string; message: string }>
}

/**
 * Shape confirmed against the live API on 2026-09-16, not guessed from the
 * OpenAPI spec — the spec lists a subset of these fields, and an OpenAPI object
 * is open by default, so it is incomplete rather than wrong.
 */
export interface BoundarySet {
  id?: string
  name: string
  available?: boolean
  boundaryCount?: number
  /** Keys allowed to query this set — id AND label, not bare ids. */
  grantedKeys?: Array<{ id: string; label: string }>
  createdAt?: string
  updatedAt?: string
}
