/**
 * radar-handler.ts — Server-only ECCC MSC GeoMet radar handler.
 *
 * IMPORTED ONLY FROM src/server.ts. Never imported from client-side code.
 *
 * Route: GET /api/radar-now?lat=<lat>&lon=<lon>
 *
 * ── GeoMet layers used ───────────────────────────────────────────────────────
 * RADAR_1KM_RRAI        — Rain precipitation rate (mm/hour), ~1 km, ~6 min updates
 * RADAR_COVERAGE_RRAI   — Coverage mask for RADAR_1KM_RRAI (boolean/numeric)
 *
 * Both layers are queried independently via WMS 1.3.0 GetFeatureInfo with
 * INFO_FORMAT=application/json. Coverage is checked first; the rain rate is
 * only trusted when coverage confirms the point is inside the radar mosaic.
 *
 * ── WMS 1.3.0 BBOX axis order ───────────────────────────────────────────────
 * Per OGC WMS 1.3.0 §7.2.4.6.10 and the EPSG:4326 axis definition:
 *   CRS=EPSG:4326 → BBOX order is: minLat,minLon,maxLat,maxLon
 *   (latitude is the first axis for geographic CRSes in WMS 1.3.0)
 *
 * This differs from WMS 1.1.x which used lon,lat order.
 * The BBOX string we build is therefore: lat-delta,lon-delta,lat+delta,lon+delta
 * which correctly centres the query on the target coordinates.
 *
 * Example for Scarborough (lat=43.77, lon=-79.25, delta=0.02):
 *   BBOX=43.75,-79.27,43.79,-79.23   ✓ (lat-first, WMS 1.3.0)
 *
 * ── Coverage semantics ───────────────────────────────────────────────────────
 * We use RADAR_COVERAGE_RRAI to explicitly confirm coverage before reading the
 * rain rate from RADAR_1KM_RRAI. This avoids the ambiguity where a null or
 * absent value in the rain-rate response could mean either:
 *   (a) outside the radar mosaic coverage area, OR
 *   (b) inside coverage but zero precipitation
 *
 * Classification logic:
 *   RADAR_COVERAGE_RRAI features empty / value ≤ 0    → no-coverage
 *   RADAR_COVERAGE_RRAI value > 0 (covered):
 *     RADAR_1KM_RRAI value is a positive number > threshold  → precipitation
 *     RADAR_1KM_RRAI value is a number ≤ threshold           → dry
 *     RADAR_1KM_RRAI value is null / absent / non-numeric   → unavailable
 *       (covered but measurement ambiguous — do not claim dry)
 *
 * ── GeoMet GetFeatureInfo response schema ────────────────────────────────────
 * Both layers return WMS 1.3.0 GeoJSON-style responses of this form:
 * {
 *   "type": "FeatureCollection",
 *   "features": [
 *     {
 *       "type": "Feature",
 *       "geometry": null,
 *       "properties": {
 *         "value": <number | null>    // the numeric measurement or null
 *       }
 *     }
 *   ]
 * }
 * features: []  — point is outside the layer's spatial extent / time window
 * features with value:null — within spatial extent but no measurement at this pixel
 * features with value:<number> — numeric measurement in layer units
 *
 * For RADAR_COVERAGE_RRAI: value > 0 = covered, value = 0 or null = not covered
 * For RADAR_1KM_RRAI: value in mm/hour (rain rate)
 *
 * ── Caching ──────────────────────────────────────────────────────────────────
 * Results are cached by rounded coordinate (0.02° ≈ 2 km) + radar TIME string.
 * TTL = 3 minutes. Radar composites update every ~6 minutes, so this means
 * at most one GeoMet round-trip per radar cycle per location cluster.
 *
 * ── Failure policy ───────────────────────────────────────────────────────────
 * - GetCapabilities failure → return "unavailable" (no computed TIME fallback)
 * - GetFeatureInfo HTTP error → return "unavailable"
 * - 10s request timeout → return "unavailable"
 * - Any parse error → return "unavailable"
 * - A radar failure NEVER throws; the weather page uses Open-Meteo fallback.
 */

import type { RadarPrecipObservation } from "./radar-types";
import { RADAR_RAIN_THRESHOLD_MM_PER_HR } from "./radar-types";

// ── Constants ────────────────────────────────────────────────────────────────

const GEOMET_BASE      = "https://geo.weather.gc.ca/geomet";
const RAIN_LAYER       = "RADAR_1KM_RRAI";
const COVERAGE_LAYER   = "RADAR_COVERAGE_RRAI";
const REQUEST_TIMEOUT  = 10_000; // ms
const CACHE_TTL_MS     = 3 * 60 * 1000; // 3 min

// Canadian bounding box — errs towards inclusion for border cities.
const CANADA_LAT_MIN = 41.5;
const CANADA_LAT_MAX = 83.5;
const CANADA_LON_MIN = -141.0;
const CANADA_LON_MAX = -52.0;

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry { result: RadarPrecipObservation; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

function roundCoord(v: number, grid = 0.02) { return Math.round(v / grid) * grid; }

function cacheKey(lat: number, lon: number, time: string) {
  return `${roundCoord(lat).toFixed(2)},${roundCoord(lon).toFixed(2)},${time}`;
}

function getCached(lat: number, lon: number, time: string): RadarPrecipObservation | null {
  const e = cache.get(cacheKey(lat, lon, time));
  if (!e) return null;
  if (Date.now() > e.expiresAt) { cache.delete(cacheKey(lat, lon, time)); return null; }
  return e.result;
}

function setCached(lat: number, lon: number, time: string, r: RadarPrecipObservation) {
  if (cache.size >= 500) {
    const now = Date.now();
    let evicted = false;
    for (const [k, v] of cache) { if (v.expiresAt < now) { cache.delete(k); evicted = true; } }
    if (!evicted) { const fk = cache.keys().next().value; if (fk) cache.delete(fk); }
  }
  cache.set(cacheKey(lat, lon, time), { result: r, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── TIME: GetCapabilities only, no computed fallback ─────────────────────────

/**
 * Fetch the most-recent TIME value for RADAR_1KM_RRAI via GetCapabilities.
 * Returns null if GetCapabilities fails — caller must return "unavailable".
 *
 * IMPORTANT: We do NOT fall back to a computed/guessed timestamp.
 * If GetCapabilities fails we cannot know what TIME values GeoMet accepts,
 * and a guessed timestamp may yield a 400 error or a stale response.
 */
/**
 * Validate that a string is an absolute ISO timestamp (not a duration like PT6M).
 * Accepts strings that start with 4-digit year and parse to a finite epoch ms.
 * Rejects ISO duration strings (starting with P) and any non-parseable values.
 */
function isAbsoluteIso(s: string): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}T/.test(s)) return false;
  return isFinite(Date.parse(s));
}

/**
 * Extract the most-recent TIME value from the RADAR_1KM_RRAI WMS 1.3.0
 * GetCapabilities Dimension element.
 *
 * Real GeoMet Dimension (confirmed 2026-09-03):
 *   <Dimension name="time" default="2026-09-03T02:30:00Z" ...>
 *     2026-09-02T23:30:00Z/2026-09-03T02:30:00Z/PT6M
 *   </Dimension>
 *
 * Parsing strategy (order of preference):
 *   1. `default` attribute — GeoMet sets this to the most-recent available time.
 *      This is the most reliable and direct source.
 *   2. ISO 8601 interval format (start/end/period):
 *      "2026-09-02T23:30:00Z/2026-09-03T02:30:00Z/PT6M"
 *      → select the second segment (end), validate it is an absolute ISO timestamp.
 *      The third segment (PT6M) is a duration and must never be selected.
 *   3. Comma-separated timestamp list:
 *      "...T14:00Z,...T14:06Z,...T15:06Z"
 *      → select the last token that passes isAbsoluteIso().
 *   4. If none of the above yield a valid absolute ISO timestamp → return null.
 *      Caller returns "unavailable"; no guessed timestamp is ever used.
 *
 * Stage-based logging (temporary, for Vercel preview diagnosis):
 *   Logs are prefixed [radar-cap] and include each parsing step outcome.
 *   Safe to remove once production timestamps are confirmed correct.
 */
async function getMostRecentRadarTime(signal: AbortSignal): Promise<string | null> {
  try {
    const url = `${GEOMET_BASE}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0&LAYERS=${RAIN_LAYER}`;
    console.info("[radar-cap] stage=fetch url=" + url.slice(0, 80));
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      console.warn("[radar-cap] stage=fetch-error status=" + resp.status);
      return null;
    }
    const text = await resp.text();
    console.info("[radar-cap] stage=fetched bytes=" + text.length);

    // Locate the Dimension element for RADAR_1KM_RRAI, capturing both:
    //   - the opening tag (to extract the `default` attribute)
    //   - the text content (to parse the interval or list)
    const dimMatch = text.match(
      /RADAR_1KM_RRAI[\s\S]{0,8000}?(<Dimension[^>]*name="time"[^>]*>)([\s\S]*?)<\/Dimension>/i,
    );
    if (!dimMatch) {
      console.warn("[radar-cap] stage=no-dimension");
      return null;
    }

    const openTag = dimMatch[1];       // e.g. <Dimension name="time" default="2026-09-03T02:30:00Z" ...>
    const content = dimMatch[2].trim(); // e.g. "2026-09-02T23:30:00Z/2026-09-03T02:30:00Z/PT6M"
    console.info("[radar-cap] stage=dimension-found openTag=" + openTag.slice(0, 120));
    console.info("[radar-cap] stage=dimension-content content=" + content.slice(0, 120));

    // ── Strategy 1: default attribute ──────────────────────────────────────
    const defaultMatch = openTag.match(/\bdefault="([^"]+)"/i);
    if (defaultMatch) {
      const defaultVal = defaultMatch[1].trim();
      if (isAbsoluteIso(defaultVal)) {
        console.info("[radar-cap] stage=selected source=default value=" + defaultVal);
        return defaultVal;
      }
      console.warn("[radar-cap] stage=default-invalid value=" + defaultVal);
    }

    // ── Strategy 2: ISO 8601 interval (start/end/period) ───────────────────
    // Detected by: contains exactly 2 slashes and third segment looks like a duration
    const slashParts = content.split("/").map(s => s.trim());
    if (slashParts.length === 3) {
      const [, end, period] = slashParts;
      // Verify it really is an interval: period must start with P (ISO 8601 duration)
      if (period.startsWith("P") && isAbsoluteIso(end)) {
        console.info("[radar-cap] stage=selected source=interval-end value=" + end);
        return end;
      }
      console.warn("[radar-cap] stage=interval-parse-fail parts=" + slashParts.join("|"));
    }

    // ── Strategy 3: comma-separated timestamp list ──────────────────────────
    if (content.includes(",")) {
      const candidates = content.split(",").map(s => s.trim()).filter(isAbsoluteIso);
      if (candidates.length > 0) {
        const last = candidates[candidates.length - 1];
        console.info("[radar-cap] stage=selected source=list-last value=" + last);
        return last;
      }
      console.warn("[radar-cap] stage=list-no-valid-timestamps");
    }

    // ── Strategy 4: single absolute timestamp ───────────────────────────────
    if (isAbsoluteIso(content)) {
      console.info("[radar-cap] stage=selected source=single value=" + content);
      return content;
    }

    console.warn("[radar-cap] stage=no-valid-timestamp content=" + content.slice(0, 80));
    return null;
  } catch (err) {
    console.error("[radar-cap] stage=exception", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── GetFeatureInfo: parse a single layer's feature value ─────────────────────

// ── WMS 1.3.0 BBOX builder ───────────────────────────────────────────────────

/**
 * Build a WMS 1.3.0 BBOX string for CRS=EPSG:4326.
 *
 * Per OGC WMS 1.3.0 §7.2.4.6.10, EPSG:4326 uses latitude as the first axis:
 *   BBOX = minLat,minLon,maxLat,maxLon
 *
 * For Scarborough (lat=43.77, lon=-79.25, delta=0.02):
 *   BBOX = "43.75,-79.27,43.79,-79.23"
 */
export function buildWms13Bbox(lat: number, lon: number, delta: number): string {
  return `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
}

// ── Coverage parser (RADAR_COVERAGE_RRAI) ────────────────────────────────────
//
// Real GeoMet response (confirmed Scarborough 2026-09-03):
// {
//   "type": "FeatureCollection",
//   "name": "RADAR_COVERAGE_RRAI",
//   "features": [{
//     "type": "Feature",
//     "properties": { "type": "radar_coverage" },
//     "geometry": { "type": "MultiPolygon", "coordinates": [...] }
//   }]
// }
//
// There is NO properties.value field on this layer.
// Coverage is confirmed by: feature present + properties.type === "radar_coverage"
//                         + geometry is Polygon or MultiPolygon.
//
// Empty features → no-coverage.
// Present feature but malformed geometry → unavailable.
// We do NOT log the full geometry (it is extremely large).

type CoverageResult = "covered" | "no-coverage" | "unavailable";

export function parseCoverageResponse(json: unknown): CoverageResult {
  if (typeof json !== "object" || json === null) return "unavailable";
  const fc = json as { type?: unknown; features?: unknown[] };

  // Must be a FeatureCollection
  if (fc.type !== "FeatureCollection") return "unavailable";
  if (!Array.isArray(fc.features)) return "unavailable";

  // Empty features = outside coverage area
  if (fc.features.length === 0) return "no-coverage";

  // Require a Feature with the correct properties and a valid polygon geometry
  const feature = fc.features[0] as {
    type?: unknown;
    properties?: { type?: unknown };
    geometry?: { type?: unknown };
  };

  if (feature?.type !== "Feature") return "unavailable";

  // properties.type must be "radar_coverage"
  const propType = feature.properties?.type;
  if (propType !== "radar_coverage") return "unavailable";

  // geometry must be Polygon or MultiPolygon (do not validate coordinates — too large)
  const geomType = feature.geometry?.type;
  if (geomType !== "Polygon" && geomType !== "MultiPolygon") return "unavailable";

  return "covered";
}

// ── Rain-rate parser (RADAR_1KM_RRAI) ────────────────────────────────────────
//
// Real GeoMet response (confirmed Scarborough 2026-09-03):
// {
//   "type": "FeatureCollection",
//   "layer": "RADAR_1KM_RRAI",
//   "features": [{
//     "type": "Feature",
//     "id": "RADAR_1KM_RRAI(-79.257915,43.76811)",
//     "geometry": { "type": "Point", "coordinates": [-79.2579, 43.7681] },
//     "properties": {
//       "value": 0,
//       "class": "Undetected",
//       "title_en": "Radar precipitation rate for rain [mm/h]",
//       "time": "2026-09-03T02:42:00Z",
//       "dim_reference_time": "N/A"
//     }
//   }]
// }
//
// GeoMet returns the radar grid-cell CENTRE coordinates, which differ slightly
// from the queried point. GeoJSON Point coordinates are [longitude, latitude].
//
// Observed real deltas (Scarborough 2026-09-03):
//   requested:  lat 43.77,    lon -79.25
//   returned:   lat 43.7681,  lon -79.2579
//   difference: lat  0.0019°, lon  0.0079°
//
// The WMS request uses BBOX_DELTA = 0.02°. We add GRID_SNAP_TOLERANCE = 0.01°
// to account for radar grid-cell snapping beyond the BBOX edge. This gives
// MAX_COORD_DELTA = 0.03° per axis — tight enough to catch a swapped lat/lon
// (which would produce a ~123° error for Canadian coordinates) or a completely
// unrelated cell returned by a service error.
const BBOX_DELTA         = 0.02; // degrees — matches the WMS GetFeatureInfo BBOX
const GRID_SNAP_TOLERANCE = 0.01; // degrees — additional allowance for grid snapping
export const MAX_COORD_DELTA = BBOX_DELTA + GRID_SNAP_TOLERANCE; // 0.03°

interface RainRateResult {
  /** Rain rate in mm/hour. >= 0. */
  rateMmPerHour: number;
  /** UTC ISO timestamp from properties.time — the actual radar scan time. */
  observedAt: string;
}

export function parseRainRateResponse(
  json: unknown,
  requestedLat: number,
  requestedLon: number,
): RainRateResult | null {
  if (typeof json !== "object" || json === null) return null;
  const fc = json as { type?: unknown; layer?: unknown; features?: unknown[] };

  if (fc.type !== "FeatureCollection") return null;
  if (!Array.isArray(fc.features) || fc.features.length === 0) return null;

  // When present, validate that the layer field identifies the correct layer
  if (fc.layer !== undefined && fc.layer !== RAIN_LAYER) return null;

  const feature = fc.features[0] as {
    type?: unknown;
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: {
      value?: unknown;
      time?: unknown;
      [key: string]: unknown;
    };
  };

  if (feature?.type !== "Feature") return null;

  // Require Point geometry (GeoMet returns the grid-cell centre point)
  const geom = feature.geometry;
  if (geom?.type !== "Point") return null;

  // Validate that the returned Point coordinates are within MAX_COORD_DELTA (0.03°)
  // of the requested point, per axis.
  //
  // GeoJSON Point coordinates are [longitude, latitude] — confirmed by the real
  // Scarborough response: [-79.2579, 43.7681] where coords[0] is lon, coords[1] is lat.
  //
  // A swapped lat/lon would produce a delta of ~123° for Canadian coordinates and
  // is caught by the same check (0.03° threshold is far below that).
  const coords = geom.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const retLon = coords[0] as unknown; // GeoJSON: longitude is index 0
    const retLat = coords[1] as unknown; // GeoJSON: latitude  is index 1
    if (typeof retLon === "number" && typeof retLat === "number") {
      if (
        Math.abs(retLat - requestedLat) > MAX_COORD_DELTA ||
        Math.abs(retLon - requestedLon) > MAX_COORD_DELTA
      ) {
        console.warn(
          `[radar-rain] returned coords lat=${retLat} lon=${retLon} exceed ` +
          `MAX_COORD_DELTA=${MAX_COORD_DELTA}° from ` +
          `requested lat=${requestedLat} lon=${requestedLon}`,
        );
        return null;
      }
    }
  }

  const props = feature.properties;
  if (!props) return null;

  // value must be a finite number >= 0
  const v = props.value;
  if (typeof v !== "number" || !isFinite(v) || v < 0) return null;

  // time must be an absolute ISO timestamp (this is the actual scan time)
  const t = props.time;
  if (typeof t !== "string" || !isAbsoluteIso(t)) return null;

  return { rateMmPerHour: v, observedAt: t };
}

// ── GetFeatureInfo request builder ───────────────────────────────────────────

function buildFeatureInfoUrl(
  layer: string,
  lat: number,
  lon: number,
  radarTime: string,
): string {
  const url = new URL(GEOMET_BASE);
  url.searchParams.set("SERVICE",      "WMS");
  url.searchParams.set("VERSION",      "1.3.0");
  url.searchParams.set("REQUEST",      "GetFeatureInfo");
  url.searchParams.set("LAYERS",       layer);
  url.searchParams.set("QUERY_LAYERS", layer);
  url.searchParams.set("INFO_FORMAT",  "application/json");
  url.searchParams.set("CRS",          "EPSG:4326");
  url.searchParams.set("BBOX",         buildWms13Bbox(lat, lon, 0.02));
  url.searchParams.set("WIDTH",        "3");
  url.searchParams.set("HEIGHT",       "3");
  url.searchParams.set("I",            "1");
  url.searchParams.set("J",            "1");
  url.searchParams.set("TIME",         radarTime);
  return url.toString();
}

// ── Public: queryRadarNow ─────────────────────────────────────────────────────

export async function queryRadarNow(
  lat: number,
  lon: number,
): Promise<RadarPrecipObservation> {
  if (
    lat < CANADA_LAT_MIN || lat > CANADA_LAT_MAX ||
    lon < CANADA_LON_MIN || lon > CANADA_LON_MAX
  ) {
    return { status: "no-coverage", source: "eccc-radar" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const radarTime = await getMostRecentRadarTime(controller.signal);
    if (!radarTime) {
      // GetCapabilities failed — cannot query reliably; return unavailable.
      return { status: "unavailable", source: "eccc-radar" };
    }

    const cached = getCached(lat, lon, radarTime);
    if (cached) return cached;

    // ── Step 1: Coverage layer ─────────────────────────────────────────────
    // RADAR_COVERAGE_RRAI returns a polygon geometry (not a numeric value).
    // parseCoverageResponse() interprets the real GeoMet schema.
    let covJson: unknown;
    try {
      const covResp = await fetch(buildFeatureInfoUrl(COVERAGE_LAYER, lat, lon, radarTime), { signal: controller.signal });
      if (!covResp.ok) return { status: "unavailable", source: "eccc-radar" };
      covJson = await covResp.json();
    } catch {
      return { status: "unavailable", source: "eccc-radar" };
    }
    const coverage = parseCoverageResponse(covJson);
    if (coverage === "no-coverage") {
      const r: RadarPrecipObservation = { status: "no-coverage", observedAt: radarTime, source: "eccc-radar" };
      setCached(lat, lon, radarTime, r);
      return r;
    }
    if (coverage === "unavailable") {
      return { status: "unavailable", source: "eccc-radar" };
    }

    // ── Step 2: Rain-rate layer ─────────────────────────────────────────────
    // RADAR_1KM_RRAI returns properties.value (mm/hour) and properties.time
    // (the actual radar scan timestamp, which becomes observedAt).
    let rainJson: unknown;
    try {
      const rainResp = await fetch(buildFeatureInfoUrl(RAIN_LAYER, lat, lon, radarTime), { signal: controller.signal });
      if (!rainResp.ok) return { status: "unavailable", source: "eccc-radar" };
      rainJson = await rainResp.json();
    } catch {
      return { status: "unavailable", source: "eccc-radar" };
    }
    const rain = parseRainRateResponse(rainJson, lat, lon);

    let result: RadarPrecipObservation;
    if (!rain) {
      // Covered but rain-rate parse failed (null value, bad time, wrong layer, etc.)
      result = { status: "unavailable", observedAt: radarTime, source: "eccc-radar" };
    } else if (rain.rateMmPerHour > RADAR_RAIN_THRESHOLD_MM_PER_HR) {
      result = { status: "precipitation", rateMmPerHour: rain.rateMmPerHour, observedAt: rain.observedAt, source: "eccc-radar" };
    } else {
      // Numeric value at or below threshold: confirmed dry within coverage.
      // observedAt comes from properties.time on the rain-rate feature.
      result = { status: "dry", observedAt: rain.observedAt, source: "eccc-radar" };
    }

    setCached(lat, lon, radarTime, result);
    return result;
  } catch {
    return { status: "unavailable", source: "eccc-radar" };
  } finally {
    clearTimeout(timer);
  }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

export async function handleRadarNow(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");
  if (!latStr || !lonStr) {
    return new Response(JSON.stringify({ error: "lat and lon are required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return new Response(JSON.stringify({ error: "invalid lat/lon" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const result = await queryRadarNow(lat, lon);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=120, s-maxage=120" },
  });
}
