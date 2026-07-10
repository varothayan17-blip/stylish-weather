/**
 * canadianLocalities.ts
 *
 * Curated dataset of Canadian localities that major geocoding APIs
 * (Open-Meteo / GeoNames) commonly omit or misrank — typically because they
 * are former municipalities now amalgamated into a larger city, informal
 * neighbourhood names, or well-known districts without a standalone GeoNames
 * entry.
 *
 * Each entry is shaped as a GeoResult so it can be merged directly into the
 * search result pool before ranking. The `_isLocality` flag lets the ranking
 * engine apply a small preference boost over unrelated foreign results.
 *
 * ── Maintenance ───────────────────────────────────────────────────────────
 * Add entries in alphabetical order within each city grouping.
 * Coordinates are the geographic centroid of the district/locality.
 * `aliases` should be lowercase and cover common search variants.
 * Population values are approximate and used only for ranking tier placement.
 */

export type CanadianLocality = {
  name: string;
  admin1: string;      // province name
  country: string;     // ISO 3166-1 alpha-2, always "CA"
  lat: number;
  lon: number;
  population: number;
  featureCode: string; // GeoNames-style code for ranking
  aliases: string[];   // lowercase; all forms a user might type
};

export const CANADIAN_LOCALITIES: CanadianLocality[] = [

  // ── Toronto — former boroughs (amalgamated 1998) ───────────────────────
  // Absent from GeoNames as independent entries because they ceased to be
  // separate municipalities. Residents still use these names daily.
  {
    name: "East York",
    admin1: "Ontario",
    country: "CA",
    lat: 43.6934,
    lon: -79.3296,
    population: 117_000,
    featureCode: "PPLA2",
    aliases: [
      "east york",
      "east york on",
      "east york ontario",
      "east york toronto",
    ],
  },
  {
    name: "Etobicoke",
    admin1: "Ontario",
    country: "CA",
    lat: 43.6985,
    lon: -79.5655,
    population: 348_000,
    featureCode: "PPLA2",
    aliases: [
      "etobicoke",
      "etobicoke on",
      "etobicoke ontario",
      "etobicoke toronto",
    ],
  },
  {
    name: "North York",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7615,
    lon: -79.4111,
    population: 660_000,
    featureCode: "PPLA2",
    aliases: [
      "north york",
      "north york on",
      "north york ontario",
      "north york toronto",
    ],
  },
  {
    name: "Scarborough",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7764,
    lon: -79.2318,
    population: 630_000,
    featureCode: "PPLA2",
    aliases: [
      "scarborough",
      "scarborough on",
      "scarborough ontario",
      "scarborough toronto",
    ],
  },
  {
    name: "York",
    admin1: "Ontario",
    country: "CA",
    lat: 43.6895,
    lon: -79.4733,
    population: 153_000,
    featureCode: "PPLA2",
    aliases: [
      "york",
      "york on",
      "york ontario",
      "york toronto",
    ],
  },

  // ── Toronto — neighbourhoods and districts ─────────────────────────────
  // Informal but widely recognised place names within the amalgamated city.
  {
    name: "Agincourt",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7889,
    lon: -79.2689,
    population: 70_000,
    featureCode: "PPLX",
    aliases: [
      "agincourt",
      "agincourt on",
      "agincourt ontario",
      "agincourt toronto",
      "agincourt scarborough",
    ],
  },
  {
    name: "The Beaches",
    admin1: "Ontario",
    country: "CA",
    lat: 43.6762,
    lon: -79.3020,
    population: 26_000,
    featureCode: "PPLX",
    aliases: [
      "the beaches",
      "beaches toronto",
      "the beach toronto",
      "the beach",
      "beaches",
    ],
  },
  {
    name: "Don Mills",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7305,
    lon: -79.3398,
    population: 45_000,
    featureCode: "PPLX",
    aliases: [
      "don mills",
      "don mills on",
      "don mills ontario",
      "don mills toronto",
    ],
  },
  {
    name: "Downsview",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7487,
    lon: -79.4780,
    population: 55_000,
    featureCode: "PPLX",
    aliases: [
      "downsview",
      "downsview on",
      "downsview ontario",
      "downsview toronto",
      "downsview north york",
    ],
  },
  {
    name: "Leslieville",
    admin1: "Ontario",
    country: "CA",
    lat: 43.6631,
    lon: -79.3335,
    population: 18_000,
    featureCode: "PPLX",
    aliases: [
      "leslieville",
      "leslieville toronto",
      "leslieville on",
    ],
  },
  {
    name: "Liberty Village",
    admin1: "Ontario",
    country: "CA",
    lat: 43.6393,
    lon: -79.4218,
    population: 12_000,
    featureCode: "PPLX",
    aliases: [
      "liberty village",
      "liberty village toronto",
      "liberty village on",
    ],
  },
  {
    name: "Malvern",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8100,
    lon: -79.2310,
    population: 38_000,
    featureCode: "PPLX",
    aliases: [
      "malvern",
      "malvern toronto",
      "malvern scarborough",
      "malvern on",
    ],
  },
  {
    name: "Rexdale",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7320,
    lon: -79.5839,
    population: 42_000,
    featureCode: "PPLX",
    aliases: [
      "rexdale",
      "rexdale toronto",
      "rexdale etobicoke",
      "rexdale on",
    ],
  },
  {
    name: "Scarborough Village",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7448,
    lon: -79.2128,
    population: 18_000,
    featureCode: "PPLX",
    aliases: [
      "scarborough village",
      "scarborough village on",
      "scarborough village ontario",
      "scarborough village toronto",
    ],
  },
  {
    name: "Willowdale",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7716,
    lon: -79.4132,
    population: 60_000,
    featureCode: "PPLX",
    aliases: [
      "willowdale",
      "willowdale toronto",
      "willowdale north york",
      "willowdale on",
    ],
  },

  // ── York Region ────────────────────────────────────────────────────────
  {
    name: "Aurora",
    admin1: "Ontario",
    country: "CA",
    lat: 43.9991,
    lon: -79.4686,
    population: 67_000,
    featureCode: "PPL",
    aliases: [
      "aurora",
      "aurora on",
      "aurora ontario",
      "aurora york region",
    ],
  },
  {
    name: "Markham",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8561,
    lon: -79.3370,
    population: 353_000,
    featureCode: "PPL",
    aliases: [
      "markham",
      "markham on",
      "markham ontario",
      "markham toronto",
    ],
  },
  {
    name: "Newmarket",
    admin1: "Ontario",
    country: "CA",
    lat: 44.0535,
    lon: -79.4608,
    population: 90_000,
    featureCode: "PPL",
    aliases: [
      "newmarket",
      "newmarket on",
      "newmarket ontario",
    ],
  },
  {
    name: "Richmond Hill",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8828,
    lon: -79.4403,
    population: 202_000,
    featureCode: "PPL",
    aliases: [
      "richmond hill",
      "richmond hill on",
      "richmond hill ontario",
    ],
  },
  {
    name: "Stouffville",
    admin1: "Ontario",
    country: "CA",
    lat: 43.9709,
    lon: -79.2493,
    population: 50_000,
    featureCode: "PPL",
    aliases: [
      "stouffville",
      "stouffville on",
      "stouffville ontario",
      "whitchurch stouffville",
    ],
  },
  {
    name: "Thornhill",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8097,
    lon: -79.4240,
    population: 110_000,
    featureCode: "PPL",
    aliases: [
      "thornhill",
      "thornhill on",
      "thornhill ontario",
      "thornhill york region",
    ],
  },
  {
    name: "Unionville",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8725,
    lon: -79.3073,
    population: 18_000,
    featureCode: "PPLX",
    aliases: [
      "unionville",
      "unionville on",
      "unionville ontario",
      "unionville markham",
    ],
  },
  {
    name: "Vaughan",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8361,
    lon: -79.4985,
    population: 344_000,
    featureCode: "PPL",
    aliases: [
      "vaughan",
      "vaughan on",
      "vaughan ontario",
    ],
  },

  // ── Peel Region ────────────────────────────────────────────────────────
  {
    name: "Brampton",
    admin1: "Ontario",
    country: "CA",
    lat: 43.7315,
    lon: -79.7624,
    population: 656_000,
    featureCode: "PPL",
    aliases: [
      "brampton",
      "brampton on",
      "brampton ontario",
    ],
  },
  {
    name: "Mississauga",
    admin1: "Ontario",
    country: "CA",
    lat: 43.5890,
    lon: -79.6441,
    population: 721_000,
    featureCode: "PPL",
    aliases: [
      "mississauga",
      "mississauga on",
      "mississauga ontario",
    ],
  },

  // ── Durham Region ──────────────────────────────────────────────────────
  {
    name: "Ajax",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8508,
    lon: -79.0204,
    population: 132_000,
    featureCode: "PPL",
    aliases: [
      "ajax",
      "ajax on",
      "ajax ontario",
      "ajax durham",
    ],
  },
  {
    name: "Oshawa",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8971,
    lon: -78.8658,
    population: 170_000,
    featureCode: "PPL",
    aliases: [
      "oshawa",
      "oshawa on",
      "oshawa ontario",
      "oshawa durham",
    ],
  },
  {
    name: "Pickering",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8354,
    lon: -79.0893,
    population: 104_000,
    featureCode: "PPL",
    aliases: [
      "pickering",
      "pickering on",
      "pickering ontario",
      "pickering durham",
    ],
  },
  {
    name: "Whitby",
    admin1: "Ontario",
    country: "CA",
    lat: 43.8975,
    lon: -78.9429,
    population: 140_000,
    featureCode: "PPL",
    aliases: [
      "whitby",
      "whitby on",
      "whitby ontario",
      "whitby durham",
    ],
  },

  // ── Halton Region ──────────────────────────────────────────────────────
  {
    name: "Burlington",
    admin1: "Ontario",
    country: "CA",
    lat: 43.3255,
    lon: -79.7990,
    population: 186_000,
    featureCode: "PPL",
    aliases: [
      "burlington",
      "burlington on",
      "burlington ontario",
      "burlington halton",
    ],
  },
  {
    name: "Milton",
    admin1: "Ontario",
    country: "CA",
    lat: 43.5183,
    lon: -79.8827,
    population: 132_000,
    featureCode: "PPL",
    aliases: [
      "milton",
      "milton on",
      "milton ontario",
      "milton halton",
    ],
  },
  {
    name: "Oakville",
    admin1: "Ontario",
    country: "CA",
    lat: 43.4675,
    lon: -79.6877,
    population: 213_000,
    featureCode: "PPL",
    aliases: [
      "oakville",
      "oakville on",
      "oakville ontario",
      "oakville halton",
    ],
  },

  // ── Other commonly searched Canadian localities ─────────────────────────
  {
    name: "Burnaby",
    admin1: "British Columbia",
    country: "CA",
    lat: 49.2488,
    lon: -122.9805,
    population: 249_000,
    featureCode: "PPL",
    aliases: [
      "burnaby",
      "burnaby bc",
      "burnaby british columbia",
    ],
  },
  {
    name: "Laval",
    admin1: "Quebec",
    country: "CA",
    lat: 45.5680,
    lon: -73.6926,
    population: 440_000,
    featureCode: "PPL",
    aliases: [
      "laval",
      "laval qc",
      "laval quebec",
    ],
  },
  {
    name: "Longueuil",
    admin1: "Quebec",
    country: "CA",
    lat: 45.5317,
    lon: -73.5186,
    population: 244_000,
    featureCode: "PPL",
    aliases: [
      "longueuil",
      "longueuil qc",
      "longueuil quebec",
    ],
  },
  {
    name: "Surrey",
    admin1: "British Columbia",
    country: "CA",
    lat: 49.1913,
    lon: -122.8490,
    population: 568_000,
    featureCode: "PPL",
    aliases: [
      "surrey",
      "surrey bc",
      "surrey british columbia",
    ],
  },
];
