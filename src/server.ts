import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ApiError, DEMO_KEY_NOTICE, request, usingDemoKey,
  type BoundarySet, type LookupResponse, type RouteResponse, type StreetAnswer,
} from './api.js'
import { VERSION } from './version.js'

/**
 * The AtlasFetch tools.
 *
 * Kept apart from any transport so the same definitions serve the stdio entry
 * point (`npx atlasfetch-mcp`, the published package) and, later, a hosted
 * Streamable HTTP endpoint. A transport decides who is connected; it does not
 * change what the tools do.
 *
 * Descriptions carry the caveats the API itself documents, because a model
 * choosing a tool reads only these. The two that cause real mistakes:
 * `municipal` is not always a city, and grid codes are output only.
 */

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  [key: string]: unknown
}

/** Every successful result carries the demo-key warning while one is in use. */
function ok(text: string): ToolResult {
  const body = usingDemoKey() ? `${text}\n\n${DEMO_KEY_NOTICE}` : text
  return { content: [{ type: 'text', text: body }] }
}

function fail(error: unknown): ToolResult {
  const message = error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? `Could not reach AtlasFetch: ${error.message}`
      : 'Unknown error.'
  return { content: [{ type: 'text', text: message }], isError: true }
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * The widest street answer worth showing: the unlimited entry if it found
 * anything, else the first entry that did.
 */
function summariseStreet(answers: StreetAnswer[]): string {
  const best = [...answers].reverse().find(a => a.streetName) ?? answers.find(a => a.streetName)
  if (!best) return 'street: covered, but nothing nearby'
  const number = best.streetNumber ? `${best.streetNumber} ` : ''
  const distance = best.distanceMeters === null ? '' : ` (${best.distanceMeters} m)`
  return `street: ${number}${best.streetName}${distance}`
}

/** `{ country: {...}, region: null }` becomes "country: United Kingdom (GB) · region: no match". */
function summarise(result: LookupResponse): string {
  const parts = Object.entries(result.base).map(([layer, hit]) => {
    // street is three answers, not one hit, and its null means "no data for
    // this country" rather than "nothing matched here".
    if (Array.isArray(hit)) return summariseStreet(hit)
    if (layer === 'street') return 'street: no street data for this area'
    return hit ? `${layer}: ${hit.name}${hit.code ? ` (${hit.code})` : ''}` : `${layer}: no match`
  })
  const setNames = Object.entries(result.sets)
    .filter(([, matches]) => matches.length > 0)
    .map(([name, matches]) => `${name} -> ${matches.map(m => m.name).join(', ')}`)
  if (setNames.length > 0) parts.push(`sets: ${setNames.join('; ')}`)
  return parts.join(' · ')
}

/** 840 -> "840 m", 3513 -> "3.5 km", 51000 -> "51 km". */
const distance = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km` : `${Math.round(meters)} m`

/** 44 -> "44 s", 306 -> "5 min", 3906 -> "1 h 5 min". */
function clock(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * The line before the JSON: what the route is, at a glance, with the things a
 * reader would otherwise have to dig for — a location snapped a long way, a
 * zone the route could not avoid, how far it ran inside a measured one. The
 * traffic caveat rides along, because a duration with no caveat reads as an ETA.
 */
function summariseRoute(result: RouteResponse): string {
  const { route } = result
  const parts = [`${route.mode}: ${distance(route.distanceMeters)} · ${clock(route.durationSeconds)}`]
  if (route.legs.length > 1) parts.push(`${route.legs.length} legs`)
  const stepCount = route.legs.reduce((total, leg) => total + (leg.steps?.length ?? 0), 0)
  if (stepCount > 0) parts.push(`${stepCount} steps`)
  const alternatives = result.alternatives?.length ?? 0
  if (alternatives > 0) parts.push(`${alternatives} alternative${alternatives === 1 ? '' : 's'}`)
  const far = result.locations.filter(l => l.snapDistanceMeters >= 50)
  if (far.length > 0) {
    parts.push(`a location moved ${distance(Math.max(...far.map(l => l.snapDistanceMeters)))} to reach a road`)
  }
  for (const zone of route.exposure ?? []) parts.push(`${distance(zone.metersInside)} inside ${zone.zone}`)
  const skipped = result.avoid?.skipped?.length ?? 0
  if (skipped > 0) parts.push(`${skipped} avoid zone${skipped === 1 ? '' : 's'} skipped`)
  return `${parts.join(' · ')} — free-flow, no traffic`
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'atlasfetch', version: VERSION },
    {
      instructions:
        'AtlasFetch answers "which place is this coordinate in?" — the country, region and ' +
        'municipality containing a point, the nearest street and house number (opt-in), ' +
        'plus the boundaries the caller has uploaded themselves. It also routes between ' +
        'coordinates, optionally around those same boundaries (get_route, 10 lookups a call, ' +
        'free-flow durations with no traffic). It does not do forward geocoding or place search, ' +
        'and it does not return boundary geometry for the reference layers.',
    },
  )

  // ── The lookup ─────────────────────────────────────────────────────────────
  server.registerTool(
    'lookup_location',
    {
      title: 'Look up the boundaries containing a coordinate',
      description: [
        'Reverse geocode a coordinate to the administrative areas that contain it — country,',
        'region (state or province) and municipality — as names plus ISO 3166 codes, optionally the',
        'nearest street, and matches from boundary sets the account has uploaded: all in one call.',
        '',
        'Use for: which country, region or municipality a point is in; which street a point is on',
        '(add "street" to base); geofence checks against your own polygons; tagging data with region',
        'codes.',
        'Do NOT use for: forward geocoding or place search (an address to a coordinate), or',
        'fetching boundary geometry. For a route, a travel distance or a travel time between',
        'points, use get_route instead — but note it costs 10 lookups to this one’s 1.',
        '',
        'Caveats worth repeating to the user: municipal is the finest unit AVAILABLE, not a',
        'consistent kind of thing — Los Angeles returns a city, rural Kansas returns a county, so',
        'do not assume it names a city. A layer that matched nothing comes back null. The errors',
        'array is always present: a boundary set that is unavailable or not granted to this key is',
        'skipped and reported there, while the call itself still succeeds.',
        '',
        'STREETS (opt-in via base, worldwide). base.street is ALWAYS three',
        'answers, for 5 m, 20 m and unlimited in that order,',
        'each with radiusMeters, streetNumber, streetName, postcode and distanceMeters. A numbered',
        'address within the radius wins over a nearer street (for the unlimited entry the address',
        'must still be within 20 m); otherwise the nearest named street; unnamed roads never answer.',
        'Two different nulls: base.street === null means there is no street data for the point’s',
        'country, while an entry whose fields are null means nothing was within that radius —',
        'never report them the same way. streetNumber and postcode are STRINGS (44A, 12-14, 0181),',
        'house numbers are rare outside well-mapped areas, and no street geometry is returned.',
        '',
        'One call is one billed lookup however many layers, sets or grid codes it touches, and a',
        'call that matches nothing still bills.',
      ].join('\n'),
      inputSchema: {
        lat: z.number().min(-90).max(90).describe('Latitude, -90 to 90.'),
        lng: z.number().min(-180).max(180).describe('Longitude, -180 to 180.'),
        base: z
          .array(z.enum(['country', 'region', 'municipal', 'street']))
          .optional()
          .describe(
            'Which reference layers to resolve. Defaults to country, region and municipal. ' +
              '"street" is opt-in: add it explicitly to get the nearest street.',
          ),
        sets: z
          .array(z.string().max(64))
          .optional()
          .describe('Names of the boundary sets on this account to match against. Defaults to none.'),
        encode: z
          .array(z.enum(['h3', 'pluscode']))
          .optional()
          .describe(
            'Also return the point as an H3 cell index and/or Google Plus Code. Output only — ' +
              'neither can be used AS a location, because both name areas rather than points.',
          ),
        h3res: z.number().int().min(0).max(15).optional().describe('H3 resolution 0-15. 9 is about 400 m across.'),
        pluslen: z
          .union([
            z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(10),
            z.literal(11), z.literal(12), z.literal(13), z.literal(14), z.literal(15),
          ])
          .optional()
          .describe('Plus Code length. 9 is not a valid length. 10 is about 14 m.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ lat, lng, base, sets, encode, h3res, pluslen }) => {
      try {
        const result = await request<LookupResponse>('/location/lookup', {
          query: {
            lat: String(lat),
            lng: String(lng),
            base: base?.join(','),
            set: sets?.join(','),
            encode: encode?.join(','),
            h3res: h3res === undefined ? undefined : String(h3res),
            pluslen: pluslen === undefined ? undefined : String(pluslen),
          },
        })

        const skipped = result.errors.length > 0
          ? `\n\nPartial problems (the lookup still succeeded):\n${
              result.errors.map(e => `- [${e.type}] ${e.message}`).join('\n')}`
          : ''

        return ok(`${summarise(result)}\n\n${json(result)}${skipped}`)
      } catch (error) {
        return fail(error)
      }
    },
  )

  // ── Boundary sets ──────────────────────────────────────────────────────────
  server.registerTool(
    'list_boundary_sets',
    {
      title: 'List the boundary sets on this account',
      description:
        'Lists the boundary sets on this account with their boundary counts and the API keys (id ' +
        'and label) each is granted to. A set only matches during a lookup when it is available AND ' +
        'granted to the key making the call.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await request<{ sets: BoundarySet[] }>('/boundaries/sets')
        if (result.sets.length === 0) {
          return ok('This account has no boundary sets yet. Create one with create_boundary_set.')
        }
        return ok(json(result.sets))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'create_boundary_set',
    {
      title: 'Create a boundary set',
      description: [
        'Creates an empty named set to hold your own polygons: delivery zones, service areas,',
        'sales territories.',
        '',
        'IMPORTANT, and not a bug: a new set is created unavailable and granted to no key, so it',
        'matches nothing until both are changed. Granting is addressed by API key id, and the only',
        'endpoint that lists key ids needs a browser session — which this server does not have. So',
        'this tool can create the set and add boundaries to it, but CANNOT make it queryable. Tell',
        'the user to finish that at https://atlasfetch.xyz/dashboard.',
      ].join('\n'),
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/)
          .describe(
            'A short name, used to reference the set in lookups: 1-32 letters, digits, hyphens or ' +
              'underscores, starting with a letter or digit.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        const set = await request<BoundarySet>('/boundaries/sets', { method: 'POST', body: { name } })
        return ok(
          `Created the set "${set.name}". It is not queryable yet: switch it on and grant it to an ` +
            'API key at https://atlasfetch.xyz/dashboard — that step needs a signed-in browser.' +
            `\n\n${json(set)}`,
        )
      } catch (error) {
        return fail(error)
      }
    },
  )

  // Rules transcribed from the API's boundaryService (validatePolygon,
  // validateProps, createBoundary) and plans.ts. The geometry schema is typed
  // rather than a free record, so a MultiPolygon or a whole Feature is refused
  // by the client before any request, and the schema itself tells the model
  // what shape to build.
  server.registerTool(
    'add_boundary',
    {
      title: 'Add a polygon to a boundary set',
      description: [
        'Adds ONE polygon to an existing boundary set on this account, so that lookup_location',
        'reports when a point falls inside it — delivery zones, service areas, sales territories.',
        'Each call creates a new boundary: calling twice with the same name stores two.',
        '',
        'Before calling: the set must already exist (create_boundary_set). A set matches nothing in',
        'lookups until it is switched on and granted to an API key in the dashboard at',
        'https://atlasfetch.xyz/dashboard, which this server cannot do.',
        '',
        'geometry must be a single GeoJSON Polygon — not a MultiPolygon, Feature or',
        'FeatureCollection. Positions are [longitude, latitude]. Each ring needs at least 4',
        'positions and must be closed (last position equals the first); extra rings are holes.',
        'Self-intersecting shapes are rejected. To store a MultiPolygon, add each part separately.',
        '',
        'Plan limits cap vertices per polygon (every position counts, including the closing one),',
        'properties per boundary and boundaries per set; a limit hit is refused with a message naming',
        'it. WITHOUT YOUR OWN KEY, the shared demo key is on the Public plan: at most 5 positions per',
        'polygon (a closed quadrilateral), properties only category (zone, area, route, place,',
        'other), color (green, blue, red, yellow, purple, orange) and priority (low, medium, high),',
        'and one set shared with every demo user, where adding to a full set silently deletes its',
        'oldest boundary. Never upload anything private with the demo key.',
        '',
        'Returns the stored boundary: id, set, name, properties, pointCount and createdAt.',
      ].join('\n'),
      inputSchema: {
        set: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/)
          .describe('Name of an existing set on this account (see list_boundary_sets).'),
        name: z
          .string()
          .min(1)
          .max(100)
          .describe('Label returned when a looked-up point falls inside this polygon, e.g. "Zone A".'),
        geometry: z
          .object({
            type: z.literal('Polygon'),
            coordinates: z
              .array(z.array(z.array(z.number()).min(2).max(3)).min(4))
              .min(1)
              .describe(
                'Rings of [longitude, latitude] positions. The first ring is the outline; any further ' +
                  'rings are holes. Each ring is closed: its last position repeats its first.',
              ),
          })
          .describe(
            'A GeoJSON Polygon, e.g. {"type":"Polygon","coordinates":[[[18.40,-33.93],[18.40,-33.90],' +
              '[18.44,-33.90],[18.44,-33.93],[18.40,-33.93]]]}.',
          ),
        properties: z
          .record(z.string().max(32), z.union([z.string().max(256), z.number(), z.boolean()]))
          .optional()
          .describe(
            'Optional flat key/value pairs returned with every match: keys up to 32 characters, values ' +
              'a string (up to 256 characters), number or boolean. The demo key accepts only category, ' +
              'color and priority, from fixed lists.',
          ),
      },
      // destructiveHint is true because of the Public plan: adding to its full,
      // shared set deletes the oldest boundary, which may be someone else's.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ set, name, geometry, properties }) => {
      try {
        const created = await request<unknown>('/boundaries', {
          method: 'POST',
          body: { set, name, geometry, properties },
        })
        return ok(`Added "${name}" to set "${set}".\n\n${json(created)}`)
      } catch (error) {
        return fail(error)
      }
    },
  )

  // ── Directions ─────────────────────────────────────────────────────────────
  server.registerTool(
    'get_route',
    {
      title: 'Route between coordinates, optionally avoiding your own zones',
      description: [
        'A driving, cycling, walking or truck route from the first location to the last, via any',
        'in between, with distance, duration and turn-by-turn steps.',
        '',
        'COST: a route is 10 LOOKUPS, not one. Everything it returns is included in that, but it',
        'is ten times a lookup, so do not call it in a loop to compare options without saying so.',
        '',
        'Durations are FREE-FLOW: the road network at its own speed limits, with NO live or',
        'historical traffic. Never present one as an arrival time in traffic — for that, say a',
        'traffic-aware service (Google, Mapbox) is needed.',
        '',
        'The route line is NOT returned unless geometry is set, because an encoded polyline is',
        'thousands of characters that no one reads. Ask for it only when something will draw it.',
        '',
        'Locations are SNAPPED to the nearest routable road, and locations[] in the response says',
        'how far each one moved. A large snapDistanceMeters means the answer starts somewhere else',
        'than asked — worth repeating to the user.',
        '',
        'avoidSets and exposureSets name BOUNDARY SETS on the account (list_boundary_sets), not',
        'ad-hoc shapes. avoid routes around every zone in those sets; exposure leaves the route',
        'alone and reports how far it ran inside each zone. A zone containing one of the locations',
        'cannot be avoided for that route: it is skipped and reported in avoid.skipped.',
        '',
        'Limits by plan: 2 locations and 1 alternative on the free plans, up to 25 and 2 on Pro;',
        'truck is Pro only; alternatives need exactly 2 locations. Over a cap the answer is 403,',
        'and nothing is billed. A location with no road near it, or two places with no road',
        'between them, is 422 — and that one IS billed, because the route was attempted.',
        '',
        'Not for: distance matrices, isochrones or live traffic (none exist yet), and not for',
        'which-area-is-this questions — that is lookup_location, at one lookup.',
      ].join('\n'),
      inputSchema: {
        locations: z
          .array(
            z.object({
              lat: z.number().min(-90).max(90).describe('Latitude, -90 to 90.'),
              lng: z.number().min(-180).max(180).describe('Longitude, -180 to 180.'),
            }),
          )
          .min(2)
          .max(25)
          .describe('Origin, any stops in order, then destination. 2 on the free plans, up to 25 on Pro.'),
        mode: z
          .enum(['car', 'bike', 'foot', 'truck'])
          .optional()
          .describe('Travel mode. Defaults to car. "truck" is Pro only and obeys vehicle limits.'),
        steps: z
          .boolean()
          .optional()
          .describe('Turn-by-turn steps per leg. Defaults to true here; set false for distance and time only.'),
        alternatives: z
          .number()
          .int()
          .min(0)
          .max(2)
          .optional()
          .describe('Also return up to this many other routes. Exactly 2 locations only. Plan-capped.'),
        avoidSets: z
          .array(z.string().max(64))
          .optional()
          .describe('Names of boundary sets on this account to route AROUND. Every zone in them is excluded.'),
        exposureSets: z
          .array(z.string().max(64))
          .optional()
          .describe(
            'Names of boundary sets to MEASURE against: the route is unchanged, and the answer says how ' +
              'many metres of it ran inside each zone.',
          ),
        geometry: z
          .enum(['none', 'polyline6', 'geojson'])
          .optional()
          .describe(
            'The route line. Defaults to none. Ask for polyline6 or geojson only when something will ' +
              'draw it: it is long, and an assistant cannot read it usefully.',
          ),
        language: z
          .string()
          .max(16)
          .optional()
          .describe('Language for the step instructions, e.g. "en-GB", "de-DE", "fr-FR". Defaults to en-US.'),
        vehicle: z
          .object({
            heightMeters: z.number().optional(),
            widthMeters: z.number().optional(),
            lengthMeters: z.number().optional(),
            weightTonnes: z.number().optional(),
            axleLoadTonnes: z.number().optional(),
            hazmat: z.boolean().optional(),
          })
          .optional()
          .describe('Truck dimensions and load. Only with mode "truck"; rejected otherwise.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ locations, mode, steps, alternatives, avoidSets, exposureSets, geometry, language, vehicle }) => {
      try {
        const result = await request<RouteResponse>('/route', {
          method: 'POST',
          body: {
            locations,
            mode,
            // Steps are the point of asking an assistant for directions, so they
            // are on unless turned off — the API itself defaults them off.
            steps: steps ?? true,
            alternatives,
            geometry: geometry ?? 'none',
            language,
            vehicle,
            avoid: avoidSets?.length ? { sets: avoidSets } : undefined,
            exposure: exposureSets?.length ? { sets: exposureSets } : undefined,
          },
        })

        const notes = [
          ...result.warnings.map(w => `- [${w.type}] ${w.message ?? ''}`.trimEnd()),
          ...result.errors.map(e => `- [${e.type}] ${e.message}`),
        ]
        const problems = notes.length > 0 ? `\n\nNotes (the route still answered):\n${notes.join('\n')}` : ''

        return ok(`${summariseRoute(result)}\n\n${json(result)}${problems}`)
      } catch (error) {
        return fail(error)
      }
    },
  )

  return server
}
