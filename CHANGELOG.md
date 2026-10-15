# Changelog

Every release of `atlasfetch-mcp`, newest first. Dates are when the version reached npm. The full notes for each release are on [GitHub releases](https://github.com/atlasfetch-dev/atlasfetch-mcp/releases).

Before 1.0, a minor version (0.3 → 0.4) may rename an input, always with a deprecated alias first. See [Stability](README.md#stability) for what 1.0 will promise.

## 0.4.1 — 2026-10-15

### Changed
- **`get_route` explains how trucks route.** A truck over 9 t, or with no `weightTonnes`, is capped at 80 km/h, as South African law caps goods vehicles; a lighter truck keeps car speeds. Height, width, length, weight, axle load and hazmat are checked where OpenStreetMap records road limits.
- **Errors say whether trying again can help.** An unexpected server-side error (a 5xx) now says that one more try may work, and a rate limit says nothing was billed. An avoid set that doesn't exist now says to check the name, rather than to switch the set on.
- README: new **Conventions** and **Stability** sections, and this changelog.

### Removed
- `ApiError.retryable`, an internal flag that nothing ever read. The retry advice was always in the message text, which is all a client passes on.

## 0.4.0 — 2026-10-15

### Changed
- `get_route`'s `geometry` input is now **`routeGeometry`**, matching `streetGeometry`. A plain `geometry` is a polygon you send, on `add_boundary` and `update_boundary`.

### Deprecated
- `geometry` on `get_route` still works, and `routeGeometry` wins if both are sent. **It will be removed in 1.0.**

## 0.3.3 — 2026-10-15

### Changed
- `create_boundary_set` says to grant the new set to **the key this server uses**. A lookup that skips an ungranted set now says which key to grant it to.
- `get_route`'s summary names the zones it avoided and couldn't avoid, and lists alternatives with their distance and time.
- `geocode_address`'s summary shows the matched zones and admin areas.
- An avoid set the key can't use is no longer reported as a plan limit, and validation errors name the field.

## 0.3.2 — 2026-10-14

### Added
- **Named sites** in `geocode_address`: shopping centres, office parks, complexes, hospitals, schools, airports and hotels, with `precision: site` and the name in `matched.site`. The advice says to pass on the unit or shop number.

## 0.3.1 — 2026-10-13

### Added
- **Street corners** in `geocode_address` ("Cnr Main Rd and Belmont Rd"), with `precision: intersection` and the second street in `matched.crossStreet`.

### Changed
- Erven, stands, plots, PO boxes and private bags are explained: they can't be placed, so they come back in `unmatched` at `locality`.

## 0.3.0 — 2026-10-12

### Added
- **`geocode_address`**: one South African address to a point, with a `precision` and dispatch advice.
- **`update_boundary`**: reshape a zone and keep its id, name and properties.
- **`streetGeometry`** on `lookup_location`: the matched street's line, off by default.

### Changed
- The 401 message says to copy a live key from the dashboard. Keys can now be shown again, and keys made before 12 October 2026 were revoked.
- A route's cost is stated as 10 lookups "on the standard plans".

## 0.2.0 — 2026-10-10

### Added
- **`get_route`**: car, bike, foot or truck routes between 2 and 25 coordinates, with steps, around your own zones (`avoidSets`) or measured against them (`exposureSets`). 10 lookups a route; free-flow durations, with no traffic.

## 0.1.6 — 2026-10-01

### Changed
- The street layer is no longer labelled beta.

## 0.1.5 — 2026-09-25

### Added
- The **street layer** on `lookup_location`: three answers, for 5 m, 20 m and unlimited, with house numbers where they're mapped.

## 0.1.4 — 2026-09-17

### Added
- Requests identify themselves as `atlasfetch-mcp/<version>` in the User-Agent, so adoption can be measured. Nothing about the user is sent.

## 0.1.3 — 2026-09-17

### Changed
- `add_boundary` states the API's real rules (one Polygon, closed rings, plan limits), with a typed geometry schema.

## 0.1.2 — 2026-09-17

### Changed
- The repository moved to `atlasfetch-dev`. Packaged as an MCPB bundle for Claude Desktop.

## 0.1.1 — 2026-09-16

### Changed
- Prepared for the official MCP Registry, under `xyz.atlasfetch`.

## 0.1.0 — 2026-09-16

### Added
- First release: `lookup_location`, `list_boundary_sets`, `create_boundary_set` and `add_boundary` over stdio, with a shared demo key for trying it without signing up.
