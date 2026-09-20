import { Router, type IRouter } from "express";
import {
  GetTravelSearchLinksQueryParams,
  GetTravelSearchLinksResponse,
  GetTravelWeatherQueryParams,
  GetTravelWeatherResponse,
  SearchTravelPlacesQueryParams,
  SearchTravelPlacesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const USER_AGENT = "Tripwise/1.0 (free travel discovery)";

type GeoPoint = { latitude: number; longitude: number };

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

export default router;