import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ApiError, DEMO_KEY_NOTICE, request, usingDemoKey,
  type BoundarySet, type LookupResponse,
} from './api.js'

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

const VERSION = '0.1.1'

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

/** `{ country: {...}, region: null }` becomes "country: United Kingdom (GB) · region: no match". */
function summarise(result: LookupResponse): string {
  const parts = Object.entries(result.base).map(([layer, hit]) =>
    hit ? `${layer}: ${hit.name}${hit.code ? ` (${hit.code})` : ''}` : `${layer}: no match`,
  )
  const setNames = Object.entries(result.sets)
    .filter(([, matches]) => matches.length > 0)
    .map(([name, matches]) => `${name} -> ${matches.map(m => m.name).join(', ')}`)
  if (setNames.length > 0) parts.push(`sets: ${setNames.join('; ')}`)
  return parts.join(' · ')
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'atlasfetch', version: VERSION },
    {
      instructions:
        'AtlasFetch answers "which place is this coordinate in?" — the country, region and ' +
        'municipality containing a point, plus the boundaries the caller has uploaded themselves. ' +
        'It does not do street addresses, postcodes, routing or distances, and it does not return ' +
        'boundary geometry for the reference layers.',
    },
  )

  // ── The lookup ─────────────────────────────────────────────────────────────
  server.registerTool(
    'lookup_location',
    {
      title: 'Look up the boundaries containing a coordinate',
      description: [
        'Reverse geocode a coordinate to the administrative areas that contain it — country,',
        'region (state or province) and municipality — as names plus ISO 3166 codes, and match it',
        'against boundary sets the account has uploaded, in the same call.',
        '',
        'Use for: which country, region or municipality a point is in; geofence checks against your',
        'own polygons; tagging data with region codes.',
        'Do NOT use for: street addresses or postcodes (this is not forward geocoding, and results',
        'stop at the municipality), routing, distances, or fetching boundary geometry.',
        '',
        'Caveats worth repeating to the user: municipal is the finest unit AVAILABLE, not a',
        'consistent kind of thing — Los Angeles returns a city, rural Kansas returns a county, so',
        'do not assume it names a city. A layer that matched nothing comes back null. The errors',
        'array is always present: a boundary set that is unavailable or not granted to this key is',
        'skipped and reported there, while the call itself still succeeds.',
        '',
        'One call is one billed lookup however many layers, sets or grid codes it touches, and a',
        'call that matches nothing still bills.',
      ].join('\n'),
      inputSchema: {
        lat: z.number().min(-90).max(90).describe('Latitude, -90 to 90.'),
        lng: z.number().min(-180).max(180).describe('Longitude, -180 to 180.'),
        base: z
          .array(z.enum(['country', 'region', 'municipal']))
          .optional()
          .describe('Which reference layers to resolve. Defaults to all three.'),
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
        'Lists the boundary sets on this account with their boundary counts and the API key ids ' +
        'each is granted to. A set only matches during a lookup when it is available AND granted ' +
        'to the key making the call.',
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
        name: z.string().min(1).max(32).describe('A short name, used to reference the set in lookups.'),
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

  server.registerTool(
    'add_boundary',
    {
      title: 'Add a boundary to a set',
      description:
        'Adds one GeoJSON polygon to a set on this account, with optional flat properties that come ' +
        'back on every match. Plan caps limit vertices per boundary, properties per boundary, and ' +
        'boundaries per set.',
      inputSchema: {
        set: z.string().min(1).max(32).describe('The set to add it to. It must already exist.'),
        name: z.string().min(1).max(100).describe('A name for this boundary, returned on a match.'),
        geometry: z
          .record(z.string(), z.unknown())
          .describe(
            'GeoJSON geometry, e.g. {"type":"Polygon","coordinates":[[[lng,lat],...]]}. ' +
              'Longitude comes first. A Feature or FeatureCollection is not accepted.',
          ),
        properties: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Flat key/value pairs returned with every match of this boundary.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ set, name, geometry, properties }) => {
      // Caught here rather than at the API, so the message can name the actual
      // mistake — passing a whole Feature is the common one.
      if (typeof geometry.type !== 'string' || !('coordinates' in geometry)) {
        return {
          content: [{
            type: 'text' as const,
            text:
              'geometry must be a GeoJSON geometry object with "type" and "coordinates" — a ' +
              'Feature or FeatureCollection is not accepted. Coordinates are [longitude, latitude].',
          }],
          isError: true,
        }
      }
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

  return server
}
