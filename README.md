# atlasfetch-mcp

**No signup needed to try it:** without a key it falls back to a shared public demo key, capped at 1,000 lookups a month across everyone using it. Get your own limits with a free sign-up at [atlasfetch.xyz](https://atlasfetch.xyz/dashboard).

An [MCP](https://modelcontextprotocol.io) server for [AtlasFetch](https://atlasfetch.xyz) — **reverse geocoding to administrative boundaries, and geofencing**, as tools your AI assistant can call directly.

Ask "which municipality is -33.9249, 18.4241 in?" and get **Cape Town, Western Cape, South Africa** with ISO 3166 codes — from a real point-in-polygon lookup, not the model's memory.

```
country: United Kingdom (GB) · region: England (GB-ENG) · municipal: City of Westminster (GB-WSM)
```

## What it does

| Tool | What it does |
| --- | --- |
| `lookup_location` | A coordinate becomes the country, region and municipality containing it, with ISO 3166-1 / 3166-2 codes, plus matches from your own boundary sets. Optionally returns the point as an H3 cell or Google Plus Code. |
| `list_boundary_sets` | Lists your boundary sets, their counts, and which API keys may query them. |
| `create_boundary_set` | Creates an empty set for your own polygons. |
| `add_boundary` | Adds one GeoJSON polygon, with properties returned on every match. |

**Good for:** reverse geocoding to administrative areas, geofencing against your own delivery zones or service areas, jurisdiction and region checks, tagging location data with region codes.

**Not for:** street addresses or postcodes (this is not forward geocoding — results stop at the municipality), routing, distances, map tiles, or downloading boundary geometry.

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

Create your own at [atlasfetch.xyz/dashboard](https://atlasfetch.xyz/dashboard) and set `ATLASFETCH_API_KEY`. The free Personal plan needs no card.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ATLASFETCH_API_KEY` | *(demo key)* | Your API key. |
| `ATLASFETCH_API_URL` | `https://api.atlasfetch.xyz` | Override only for local or staging APIs. |

## Two things that surprise people

**`municipal` is the finest unit available, not a consistent kind of thing.** Los Angeles returns a city; rural Kansas returns a county; some places return a district. Where a country's fine tier is patchy, a coarser complete tier answers instead, because a county beats `null` for most uses. Don't assume the value names a city.

**A new boundary set cannot be made queryable from here.** Sets are created switched off and granted to no key, and granting is addressed by API key *id* — which only a signed-in browser session can list. So this server can create a set and fill it, but the last step happens in the [dashboard](https://atlasfetch.xyz/dashboard). `create_boundary_set` says so in its response rather than leaving you with a set that silently matches nothing.

## Billing

One call is one lookup, however many layers, sets or grid codes it touches. Metering happens before matching, so a lookup that matches nothing still counts. Requests rejected as invalid or rate-limited are not billed.

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
