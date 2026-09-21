import { Router, type IRouter } from "express";
import {
  GetTravelSearchLinksQueryParams,
  GetTravelSearchLinksResponse,
  GetTravelExchangeRateQueryParams,
  GetTravelExchangeRateResponse,
  GetTravelWeatherQueryParams,
  GetTravelWeatherResponse,
  SearchTravelAirportsQueryParams,
  SearchTravelAirportsResponse,
  SearchTravelPlacesQueryParams,
  SearchTravelPlacesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OUR_AIRPORTS_URL = "https://ourairports.com/data/airports.csv";
const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest";
const USER_AGENT = "TraveL&/1.0 (free travel discovery)";
const commonCountryNames: Record<string, string> = {
  EG: "Egypt",
  ES: "Spain",
  FR: "France",
  GB: "United Kingdom",
  US: "United States",
  IT: "Italy",
  DE: "Germany",
  NL: "Netherlands",
  AE: "United Arab Emirates",
  TR: "Türkiye",
  MA: "Morocco",
  PT: "Portugal",
};

type GeoPoint = { latitude: number; longitude: number };
type AirportRecord = {
  id: string;
  city: string;
  countryCode: string;
  airportName: string;
  iataCode: string;
  latitude: number;
  longitude: number;
};

let airportCache: { expiresAt: number; records: AirportRecord[] } | null = null;
const countryNameCache = new Map<string, string>();

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function loadAirports(): Promise<AirportRecord[]> {
  if (airportCache && airportCache.expiresAt > Date.now()) return airportCache.records;

  const response = await fetch(OUR_AIRPORTS_URL, {
    headers: { Accept: "text/csv", "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`OurAirports returned ${response.status}`);

  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "");
  const index = new Map(headers.map((header, position) => [header, position]));
  const records = lines.slice(1).flatMap((line) => {
    const values = parseCsvLine(line);
    const type = values[index.get("type") ?? -1];
    const iataCode = values[index.get("iata_code") ?? -1] ?? "";
    const city = values[index.get("municipality") ?? -1] ?? "";
    const airportName = values[index.get("name") ?? -1] ?? "";
    const countryCode = values[index.get("iso_country") ?? -1] ?? "";
    const latitude = Number(values[index.get("latitude_deg") ?? -1]);
    const longitude = Number(values[index.get("longitude_deg") ?? -1]);
    if (!["large_airport", "medium_airport", "small_airport"].includes(type) ||
        !iataCode || !city || !airportName || !countryCode ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return [];
    }
    return [{
      id: values[index.get("ident") ?? -1] ?? iataCode,
      city,
      countryCode,
      airportName,
      iataCode,
      latitude,
      longitude,
    }];
  });
  airportCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, records };
  return records;
}

async function getCountryName(code: string): Promise<string> {
  const normalized = code.toUpperCase();
  if (commonCountryNames[normalized]) return commonCountryNames[normalized];
  const cached = countryNameCache.get(normalized);
  if (cached) return cached;
  try {
    const response = await fetch(`https://restcountries.com/v3.1/alpha/${normalized}?fields=name`);
    if (response.ok) {
      const body = (await response.json()) as { name?: { common?: string } };
      const name = body.name?.common;
      if (name) {
        countryNameCache.set(normalized, name);
        return name;
      }
    }
  } catch {
    // The airport result remains useful with the ISO country code.
  }
  return normalized;
}

async function geocodeCity(city: string): Promise<GeoPoint | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", city);

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Nominatim returned ${response.status}`);
  }

  const results = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
  }>;
  const first = results[0];
  if (!first?.lat || !first.lon) return null;

  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
  };
}

function overpassFilter(kind: string): string {
  switch (kind) {
    case "attraction":
      return `nwr["tourism"~"attraction|museum|gallery|viewpoint|theme_park|zoo"]`;
    case "restaurant":
      return `nwr["amenity"~"restaurant|cafe|bar|fast_food"]`;
    case "hotel":
      return `nwr["tourism"="hotel"]`;
    case "motel":
      return `nwr["tourism"="motel"]`;
    case "hostel":
      return `nwr["tourism"="hostel"]`;
    case "apartment":
      return `nwr["tourism"="apartment"]`;
    case "guest_house":
    case "guesthouse":
      return `nwr["tourism"="guest_house"]`;
    case "resort":
      return `nwr["tourism"~"hotel|resort"]["stars"~"4|5"]`;
    case "lodging":
    default:
      return `nwr["tourism"~"hotel|motel|hostel|guest_house|apartment"]`;
  }
}

function placeCategory(tags: Record<string, string>, fallback: string): string {
  return tags.tourism ?? tags.amenity ?? fallback;
}

function placeAddress(tags: Record<string, string>): string | null {
  const street = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  return [street, tags["addr:city"] ?? tags["addr:town"]]
    .filter(Boolean)
    .join(", ") || null;
}

router.get("/travel/airports", async (req, res): Promise<void> => {
  const parsed = SearchTravelAirportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q, limit } = parsed.data;
  try {
    const normalized = q.trim().toLocaleLowerCase();
    const records = await loadAirports();
    const matches = records
      .map((record) => {
        const fields = [record.iataCode, record.city, record.airportName, record.countryCode]
          .map((field) => field.toLocaleLowerCase());
        const exactCode = fields[0] === normalized;
        const cityStarts = fields[1].startsWith(normalized);
        const nameStarts = fields[2].startsWith(normalized);
        const countryStarts = fields[3].startsWith(normalized);
        if (!exactCode && !cityStarts && !nameStarts && !countryStarts &&
            !fields.some((field) => field.includes(normalized))) return null;
        const score = exactCode ? 0 : cityStarts ? 1 : nameStarts ? 2 : countryStarts ? 3 : 4;
        return { record, score };
      })
      .filter((match): match is { record: AirportRecord; score: number } => match !== null)
      .sort((left, right) => left.score - right.score || left.record.city.localeCompare(right.record.city))
      .slice(0, limit);

    const countries = new Map<string, string>();
    await Promise.all(matches.map(async ({ record }) => {
      countries.set(record.countryCode, await getCountryName(record.countryCode));
    }));
    const result = SearchTravelAirportsResponse.parse({
      query: q,
      source: "OurAirports + REST Countries",
      airports: matches.map(({ record }) => ({
        id: record.id,
        city: record.city,
        country: countries.get(record.countryCode) ?? record.countryCode,
        airportName: record.airportName,
        iataCode: record.iataCode,
        latitude: record.latitude,
        longitude: record.longitude,
        source: "OurAirports",
      })),
    });
    res.json(result);
  } catch (error) {
    req.log.error({ error, query: q }, "Travel airport search failed");
    res.status(502).json({ error: "The free airport data provider is unavailable right now." });
  }
});

router.get("/travel/places", async (req, res): Promise<void> => {
  const parsed = SearchTravelPlacesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { city, kind, limit } = parsed.data;
  try {
    const point = await geocodeCity(city);
    if (!point) {
      res.status(400).json({ error: `Could not find "${city}"` });
      return;
    }

    const query = `[out:json][timeout:25];(${overpassFilter(kind)}(around:7000,${point.latitude},${point.longitude}););out center tags;`;
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: query }),
    });
    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status}`);
    }

    const body = (await response.json()) as {
      elements?: Array<{
        type?: string;
        id?: number;
        lat?: number;
        lon?: number;
        center?: { lat?: number; lon?: number };
        tags?: Record<string, string>;
      }>;
    };

    const places = (body.elements ?? [])
      .map((element) => {
        const tags = element.tags ?? {};
        const latitude = element.lat ?? element.center?.lat;
        const longitude = element.lon ?? element.center?.lon;
        const name = tags.name ?? tags.brand;
        if (!name || latitude == null || longitude == null) return null;
        const website = tags.website ?? tags["contact:website"] ?? null;

        return {
          id: `${element.type ?? "place"}-${element.id ?? name}`,
          name,
          category: placeCategory(tags, kind),
          address: placeAddress(tags),
          latitude,
          longitude,
          website,
          mapLink: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`,
          source: "OpenStreetMap",
          price: null,
          availability: "unknown",
        };
      })
      .filter((place): place is NonNullable<typeof place> => place !== null)
      .slice(0, limit);

    const result = SearchTravelPlacesResponse.parse({
      city,
      source: "OpenStreetMap",
      retrievedAt: new Date().toISOString(),
      places,
    });
    res.json(result);
  } catch (error) {
    req.log.error({ error, city, kind }, "Travel place search failed");
    res.status(502).json({ error: "The free place data provider is unavailable right now." });
  }
});

router.get("/travel/weather", async (req, res): Promise<void> => {
  const parsed = GetTravelWeatherQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { city } = parsed.data;
  try {
    const point = await geocodeCity(city);
    if (!point) {
      res.status(400).json({ error: `Could not find "${city}"` });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const requestedStart = parsed.data.startDate;
    const requestedReturn = parsed.data.endDate;
    const startDate = requestedStart && requestedStart >= today ? requestedStart : today;
    const requestedEnd = requestedReturn && requestedReturn >= startDate
      ? requestedReturn
      : startDate;
    const start = new Date(`${startDate}T00:00:00Z`);
    const forecastWindowEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (startDate > forecastWindowEnd) {
      const result = GetTravelWeatherResponse.parse({
        city,
        source: "Open-Meteo",
        retrievedAt: new Date().toISOString(),
        latitude: point.latitude,
        longitude: point.longitude,
        days: [],
        note: "Forecasts are available only for the next 16 days; check again closer to departure.",
      });
      res.json(result);
      return;
    }
    const maxEnd = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const endDate = requestedEnd > maxEnd ? maxEnd : requestedEnd;

    const url = new URL(OPEN_METEO_URL);
    url.searchParams.set("latitude", String(point.latitude));
    url.searchParams.set("longitude", String(point.longitude));
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max",
    );
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}`);
    }

    const body = (await response.json()) as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_min?: number[];
        temperature_2m_max?: number[];
        precipitation_probability_max?: Array<number | null>;
      };
    };
    const daily = body.daily;
    const days = (daily?.time ?? []).map((date, index) => ({
      date,
      weatherCode: daily?.weather_code?.[index] ?? 0,
      minC: daily?.temperature_2m_min?.[index] ?? 0,
      maxC: daily?.temperature_2m_max?.[index] ?? 0,
      precipitationProbability: daily?.precipitation_probability_max?.[index] ?? 0,
    }));

    const result = GetTravelWeatherResponse.parse({
      city,
      source: "Open-Meteo",
      retrievedAt: new Date().toISOString(),
      latitude: point.latitude,
      longitude: point.longitude,
      days,
      note: null,
    });
    res.json(result);
  } catch (error) {
    req.log.error({ error, city }, "Travel weather search failed");
    res.status(502).json({ error: "The free weather provider is unavailable right now." });
  }
});

router.get("/travel/search-links", (req, res): void => {
  const parsed = GetTravelSearchLinksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { origin, destination, departureDate, returnDate, travelers } = parsed.data;
  const departure = departureDate;
  const returnDay = returnDate;
  const dateText = departureDate
    ? ` ${departure}${returnDay ? ` to ${returnDay}` : ""}`
    : "";
  const flightQuery = `Flights from ${origin} to ${destination}${dateText}`;
  const flightUrl = new URL("https://www.google.com/travel/flights");
  flightUrl.searchParams.set("q", flightQuery);

  const accommodationUrl = new URL("https://www.booking.com/searchresults.html");
  accommodationUrl.searchParams.set("ss", destination);
  if (departure) accommodationUrl.searchParams.set("checkin", departure);
  if (returnDay) accommodationUrl.searchParams.set("checkout", returnDay);
  accommodationUrl.searchParams.set("group_adults", String(travelers));
  accommodationUrl.searchParams.set("no_rooms", "1");

  const result = GetTravelSearchLinksResponse.parse({
    origin,
    destination,
    flightSearchUrl: flightUrl.toString(),
    accommodationSearchUrl: accommodationUrl.toString(),
    source: "Google Flights + Booking.com",
    note: "These are live provider searches. Tripwise does not book or confirm reservations.",
  });
  res.json(result);
});

router.get("/travel/exchange-rate", async (req, res): Promise<void> => {
  const parsed = GetTravelExchangeRateQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const from = parsed.data.from.toUpperCase();
  const to = parsed.data.to.toUpperCase();
  if (from === to) {
    res.json(GetTravelExchangeRateResponse.parse({
      from,
      to,
      rate: 1,
      source: "ExchangeRate-API Open Access",
      retrievedAt: new Date().toISOString(),
    }));
    return;
  }

  try {
    const url = new URL(`${EXCHANGE_RATE_URL}/${from}`);
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const body = (await response.json()) as { result?: string; rates?: Record<string, number> };
    const rate = body.rates?.[to];
    if (!rate || !Number.isFinite(rate)) throw new Error(`No rate for ${from}/${to}`);
    res.json(GetTravelExchangeRateResponse.parse({
      from,
      to,
      rate,
      source: "ExchangeRate-API Open Access",
      retrievedAt: new Date().toISOString(),
    }));
  } catch (error) {
    req.log.error({ error, from, to }, "Currency conversion failed");
    res.status(502).json({ error: "The free exchange-rate provider is unavailable for this currency pair." });
  }
});

export default router;