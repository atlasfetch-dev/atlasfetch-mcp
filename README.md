# atlasfetch-mcp

**No signup needed to try it:** without a key it falls back to a shared public demo key, capped at 1,000 lookups a month across everyone using it. Get your own limits with a free sign-up at [atlasfetch.xyz](https://atlasfetch.xyz/dashboard).

An [MCP](https://modelcontextprotocol.io) server for [AtlasFetch](https://atlasfetch.xyz) — **reverse geocoding to administrative boundaries and streets, and geofencing**, as tools your AI assistant can call directly.

Ask "which municipality is -33.9249, 18.4241 in?" and get **Cape Town, Western Cape, South Africa** with ISO 3166 codes — from a real point-in-polygon lookup, not the model's memory.

```
country: United Kingdom (GB) · region: England (GB-ENG) · municipal: City of Westminster (GB-WSM)
```

## What it does

| Tool | What it does |
| --- | --- |
| `lookup_location` | A coordinate becomes the country, region and municipality containing it, with ISO 3166-1 / 3166-2 codes, plus matches from your own boundary sets. Optionally the **nearest street** (ask for the `street` layer), and the point as an H3 cell or Google Plus Code. |
| `geocode_address` | An address becomes a point, in South Africa today, with a **precision** that says whether the house, the street or only the suburb was found — and what to do about it. |
| `get_route` | A route between 2 and 25 coordinates by car, bike, foot or truck, with turn-by-turn steps — optionally **around** your own zones, or **measuring** how far it runs inside them. |
| `list_boundary_sets` | Lists your boundary sets, their counts, and which API keys may query them. |
| `create_boundary_set` | Creates an empty set for your own polygons. |
| `add_boundary` | Adds one GeoJSON polygon, with properties returned on every match. |
| `update_boundary` | Moves or reshapes one boundary, keeping its id, name and properties. |

**Good for:** reverse geocoding to administrative areas, finding the street a point is on, geofencing against your own delivery zones or service areas, jurisdiction and region checks, tagging location data with region codes, geocoding delivery addresses in South Africa, and routing that keeps out of the areas you name.

**Not for:** geocoding outside South Africa (yet), searching for places by name, traffic-aware ETAs, distance matrices, isochrones, map tiles, or downloading boundary geometry.

### Directions

`get_route` returns distance, duration and turn-by-turn steps between 2 and 25 coordinates, for `car`, `bike`, `foot` or `truck`.

```
car: 3.5 km · 5 min · 11 steps · a location moved 62 m to reach a road — free-flow, no traffic
```

Three things worth knowing before you wire it up:

- **A route costs 10 lookups**, not one. Everything it returns is included in that, but it is ten times a lookup.
- **Durations are free-flow** — the network at its own speed limits, with no live or historical traffic. They are not ETAs. For those, use a traffic-aware service.
- **The route line is off by default** (`geometry: "none"`). An encoded polyline is thousands of characters an assistant cannot read; ask for `polyline6` or `geojson` only when something will draw it.

**Your own zones, in a route.** `avoidSets` names boundary sets to route *around*; `exposureSets` names sets to *measure* against, leaving the route alone and reporting how many metres of it ran inside each zone. A zone containing one of your locations cannot be avoided for that route — it is skipped, and the answer says so.

Plan limits apply: 2 locations on the free plans and up to 25 on Pro, truck is Pro only, and alternatives need exactly 2 locations. Over a cap the answer is a `403` and nothing is billed; a location with no road near it is a `422`, and that one **is** billed, because the route was attempted.

### Geocoding

`geocode_address` turns one address into a point — `q` on one line, or `address` already split into parts. South Africa today.

```
address · confidence 0.96 · 25 Adderley Street, Cape Town, ZA-WC — dispatch
street · confidence 0.47 · ambiguous · Long Street, Cape Town, ZA-WC — ask the customer before dispatching
```

**Read the precision before you use the point.** `address` is the house; `interpolated` is estimated between the numbers either side; `intersection` is a street corner ("Cnr Main Rd and Belmont Rd"); `site` is a named place such as a shopping centre, office park or hospital (pass the shop or unit number on to the driver); `street` is the right street but not the house; `locality` is only the suburb. The result line applies the API's own advice for deliveries: dispatch only on a house-, corner- or site-level answer that is not ambiguous, ask the recipient for a pin on a street-level one, and ask the customer when it is ambiguous. In South Africa most answers are street-level, because OpenStreetMap has house numbers on about 13% of street names.

One address per call, at 1 lookup each, found or not. That is deliberate: a delivery list goes through one row at a time, where you can see what it spends. Programs with thousands of rows should call `POST /geocode/batch` on the API directly.

### Streets

Add the `street` layer and the answer includes the nearest street, and the house number where one is mapped. It is **worldwide**, and **opt-in** — not part of the default `country, region, municipal`.

You always get three answers — for 5 m, 20 m and unlimited — because "the nearest street" depends on how far you are willing to look:

```json
"street": [
  { "radiusMeters": 5,    "streetNumber": null, "streetName": "Adderley Street", "postcode": null,   "distanceMeters": 2.7 },
  { "radiusMeters": 20,   "streetNumber": "25", "streetName": "Adderley Street", "postcode": "8001", "distanceMeters": 9.6 },
  { "radiusMeters": null, "streetNumber": "25", "streetName": "Adderley Street", "postcode": "8001", "distanceMeters": 9.6 }
]
```

**Two nulls that mean different things:** `"street": null` means there is no street data for that country, while an entry whose fields are null means nothing was within that radius. `streetNumber` and `postcode` are strings (`44A`, `12-14`, `0181`); house numbers are rare outside well-mapped areas. Set `streetGeometry` and each answer also carries the street's line, trimmed to about 250 m — leave it off unless something will draw it.

## Install

### Claude Code

```bash
claude mcp add atlasfetch -- npx -y atlasfetch-mcp
```

### Claude Desktop, Cursor, VS Code and other clients

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, or your client's equivalent):

```json
{
  "mcpServers": {
    "atlasfetch": {
      "command": "npx",
      "args": ["-y", "atlasfetch-mcp"],
      "env": {
        "ATLASFETCH_API_KEY": "your-key-here"
      }
    }
  }
}
```

Requires Node 20 or newer.

## Getting a key

The demo key is shared by **every** anonymous user on the internet — one pooled quota and rate limit. Fine for a first look, wrong for anything real.

Create your own at [atlasfetch.xyz/dashboard](https://atlasfetch.xyz/dashboard) and set `ATLASFETCH_API_KEY`. The free Personal plan needs no card. You can copy a key from the dashboard at any time — so restrict it to your own domains there. Keys made before 12 October 2026 were revoked; if yours stops working, copy a live one.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ATLASFETCH_API_KEY` | *(demo key)* | Your API key. |
| `ATLASFETCH_API_URL` | `https://api.atlasfetch.xyz` | Override only for local or staging APIs. |

## Two things that surprise people

**`municipal` is the finest unit available, not a consistent kind of thing.** Los Angeles returns a city; rural Kansas returns a county; some places return a district. Where a country's fine tier is patchy, a coarser complete tier answers instead, because a county beats `null` for most uses. Don't assume the value names a city.

**A new boundary set cannot be made queryable from here.** Sets are created switched off and granted to no key, and granting is addressed by API key *id* — which only a signed-in browser session can list. So this server can create a set and fill it, but the last step happens in the [dashboard](https://atlasfetch.xyz/dashboard). `create_boundary_set` says so in its response rather than leaving you with a set that silently matches nothing.

## Billing

A lookup or a geocoded address is one lookup; a route is 10 on the standard plans. A lookup is one, however many layers, sets or grid codes it touches. Metering happens before matching, so a lookup that matches nothing still counts. Requests rejected as invalid or rate-limited are not billed.

## Development

```bash
npm install
npm run build
node scripts/smoke.mjs   # drives the built server with a real MCP client, against the live API
```

## Links

- [Documentation](https://atlasfetch.xyz/docs) · [OpenAPI spec](https://api.atlasfetch.xyz/openapi.json) · [llms.txt](https://atlasfetch.xyz/llms.txt)
- [Playground](https://atlasfetch.xyz/playground) — try a lookup with no signup

## Licence

MIT for this server. Reference boundaries derive from OpenStreetMap under the [ODbL](https://atlasfetch.xyz/attribution); attribution and share-alike obligations pass through to you. Coordinates you look up are not stored.
