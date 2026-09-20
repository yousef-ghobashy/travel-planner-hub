---
name: No-key travel data limits
description: Provider and transport constraints for Tripwise's free travel data sources.
---

Tripwise's no-key travel layer should treat dates in query strings as `YYYY-MM-DD` strings at the HTTP boundary, not JavaScript dates. Open-Meteo's forecast endpoint is only useful for the near-term forecast window; future sample trips must render an explicit unavailable state rather than extrapolated weather.

**Why:** OpenAPI date formats generated strict `Date` parsing for query values, while real URL parameters are strings, and Open-Meteo rejects forecasts well beyond its forecast horizon.

**How to apply:** Keep query parameters transport-friendly, validate date ranges on the server, and preserve unavailable/unknown values for prices, room availability, flight fares, and out-of-window weather.