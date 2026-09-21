import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  ArrowRight, Backpack, BarChart3, BedDouble, CalendarDays, Check, ChevronRight,
  CircleDollarSign, Clock3, CloudSun, Compass, Copy, ExternalLink, FileDown, Flame,
  Heart, Home as HomeIcon, Info, Landmark, ListChecks, MapPin, Menu, Moon,
  Plane, Plus, Search, Settings2, Share2, Sparkles, Sun, Ticket, TrainFront,
  Trash2, Utensils, WalletCards, X,
} from 'lucide-react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const queryClient = new QueryClient();

/* ─── API Local ──────────────────────────────────────────────────────────── */

async function fetchSearchLinks(params: { origin: string, destination: string, departureDate: string, returnDate?: string, travelers?: number }) {
  const dep = params.departureDate;
  const ret = params.returnDate ? `/${params.returnDate}` : '';
  return {
    flightSearchUrl: `https://www.google.com/travel/flights?q=Flights%20to%20${params.destination}%20from%20${params.origin}%20on%20${dep}${ret ? `%20through%20${params.returnDate}` : ''}`,
    accommodationSearchUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(params.destination)}&checkin=${dep}&checkout=${params.returnDate || ''}&group_adults=${params.travelers || 1}`,
  };
}

async function fetchExchangeRate(from: string, to: string) {
  if (from === to) return { rate: 1, retrievedAt: new Date().toISOString() };
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  const data = await res.json();
  return { rate: data.rates[to] || 1, retrievedAt: new Date().toISOString() };
}

async function fetchWeather(city: string) {
  const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`);
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error('City not found');
  const lat = geoData[0].lat;
  const lon = geoData[0].lon;
  const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`);
  const weatherData = await weatherRes.json();
  const days: { date: string; minC: number; maxC: number; precipitationProbability: number }[] = weatherData.daily.time.map((t: string, i: number) => ({
    date: t,
    minC: weatherData.daily.temperature_2m_min[i],
    maxC: weatherData.daily.temperature_2m_max[i],
    precipitationProbability: weatherData.daily.precipitation_probability_max[i],
  }));
  return { city, retrievedAt: new Date().toISOString(), days, note: undefined };
}

async function fetchPlaces(city: string, kind: string = 'lodging') {
  const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`);
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error('City not found');
  const lat = parseFloat(geoData[0].lat);
  const lon = parseFloat(geoData[0].lon);

  const mapping: Record<string, string> = {
    lodging: 'tourism~"hotel|motel|hostel|guest_house|apartment"',
    hotel: 'tourism="hotel"',
    motel: 'tourism="motel"',
    hostel: 'tourism="hostel"',
    apartment: 'tourism="apartment"',
    guest_house: 'tourism="guest_house"'
  };
  const tag = mapping[kind] || mapping.lodging;
  const around = 5000;
  const query = `[out:json];(node[${tag}](around:${around},${lat},${lon});way[${tag}](around:${around},${lat},${lon});relation[${tag}](around:${around},${lat},${lon}););out center;`;
  
  const overpassRes = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
  const data = await overpassRes.json();
  
  const places: { id: string; name: string; category: string; address?: string; website?: string; mapLink: string; lat: number; lon: number }[] = data.elements.map((el: any) => ({
    id: el.id.toString(),
    name: el.tags?.name || 'Unnamed place',
    category: el.tags?.tourism || 'lodging',
    address: [el.tags?.['addr:street'], el.tags?.['addr:housenumber']].filter(Boolean).join(' ') || undefined,
    website: el.tags?.website,
    mapLink: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    lat: el.lat || el.center?.lat,
    lon: el.lon || el.center?.lon,
  })).slice(0, 12);

  return { city, retrievedAt: new Date().toISOString(), places };
}

let cachedAirports: any[] | null = null;
async function fetchAirports(q: string) {
  if (!cachedAirports) {
    const res = await fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json');
    const data = await res.json();
    cachedAirports = Object.values(data);
  }
  const query = q.toLowerCase();
  const matched = (cachedAirports as any[]).filter(a => 
    a.iata && a.iata !== '\\\\N' && (
      a.iata.toLowerCase().includes(query) || 
      (a.city && a.city.toLowerCase().includes(query)) ||
      (a.name && a.name.toLowerCase().includes(query))
    )
  ).slice(0, 6).map(a => ({
    id: a.iata,
    iataCode: a.iata,
    city: a.city,
    country: a.country,
    airportName: a.name,
    lat: parseFloat(a.lat),
    lon: parseFloat(a.lon)
  }));
  return { airports: matched };
}


type BudgetTier = 'Budget' | 'Economy' | 'Standard' | 'Premium' | 'Luxury';
type BudgetCurrency = 'USD' | 'EGP' | 'EUR' | 'GBP';
type BudgetSettings = { tier: BudgetTier | 'Custom'; amount: number; currency: BudgetCurrency };
type BudgetStatus = 'Within Budget' | 'Near Budget' | 'Over Budget';
type BudgetAllocation = {
  flights: number;
  accommodation: number;
  transportation: number;
  food: number;
  activities: number;
  other: number;
};

type ItineraryItem = {
  time: string;
  name: string;
  note: string;
  cost: number;
  lat?: number;
  lon?: number;
};

type ItineraryDay = {
  n: number;
  date: string;
  title: string;
  items: ItineraryItem[];
};

type LivePlace = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
};

type Trip = {
  id: string;
  name: string;
  destination: string;
  destinationCode: string;
  origin: string;
  originCode: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: BudgetSettings;
  budgetAllocation: BudgetAllocation;
  selectedFlight: string | null;
  selectedStay: string | null;
  savedActivities: string[];
  selectedLivePlaces: LivePlace[];
  itinerary: ItineraryDay[];
  createdAt: string;
  updatedAt: string;
};

type TripStore = {
  trips: Trip[];
  currentTripId: string;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */

const budgetPresets: Array<{ tier: BudgetTier; amount: number; note: string }> = [
  { tier: 'Budget', amount: 1500, note: 'Essentials first' },
  { tier: 'Economy', amount: 2200, note: 'Simple and flexible' },
  { tier: 'Standard', amount: 3500, note: 'Balanced choices' },
  { tier: 'Premium', amount: 5000, note: 'More comfort' },
  { tier: 'Luxury', amount: 8000, note: 'Make it special' },
];
const currencies: BudgetCurrency[] = ['USD', 'EGP', 'EUR', 'GBP'];
const defaultBudget: BudgetSettings = { tier: 'Standard', amount: 3500, currency: 'USD' };
const zeroBudgetAllocation: BudgetAllocation = { flights: 0, accommodation: 0, transportation: 0, food: 0, activities: 0, other: 0 };

const flights = [
  { id: 'flight-1', airline: 'Air France', code: 'AF', out: '08:10', back: '19:35', duration: '10h 45m', stops: '1 stop', price: 742, note: 'Best schedule' },
  { id: 'flight-2', airline: 'KLM', code: 'K', out: '14:25', back: '11:20', duration: '10h 10m', stops: 'Nonstop', price: 818, note: 'Recommended' },
  { id: 'flight-3', airline: 'Iberia', code: 'IB', out: '22:40', back: '13:55', duration: '11h 30m', stops: '1 stop', price: 681, note: 'Lowest estimate' },
];
const stays = [
  { id: 'stay-1', name: 'Casa Lirio', area: 'El Born · Barcelona', rating: '9.2', price: 214, note: 'Quiet courtyard, walkable to the old town', features: ['Boutique', 'Breakfast included'], lat: 41.3851, lon: 2.1834 },
  { id: 'stay-2', name: 'The Hoxton, Poblenou', area: 'Poblenou · Barcelona', rating: '8.8', price: 176, note: 'A creative base with a rooftop pool', features: ['Design-led', 'Free cancellation'], lat: 41.4035, lon: 2.2045 },
  { id: 'stay-3', name: 'Yurbban Ramblas', area: 'Eixample · Barcelona', rating: '9.0', price: 198, note: 'Calm rooms, excellent location for first visits', features: ['Central', 'Terrace'], lat: 41.3870, lon: 2.1693 },
];
const activities = [
  { id: 'activity-1', name: 'Picasso Museum', category: 'Culture', area: 'El Born', length: '2 hours', price: 18, note: 'A focused look at the artist\u2019s formative years.', color: 'hsl(14 58% 62%)', lat: 41.3853, lon: 2.1808 },
  { id: 'activity-2', name: 'Montju\u00efc sunset walk', category: 'Outdoors', area: 'Montju\u00efc', length: '2.5 hours', price: 0, note: 'Golden-hour views, gardens, and a slower pace above the city.', color: 'hsl(101 28% 52%)', lat: 41.3638, lon: 2.1586 },
  { id: 'activity-3', name: 'Casa Batll\u00f3', category: 'Architecture', area: 'Passeig de Gr\u00e0cia', length: '90 minutes', price: 39, note: 'Gaud\u00ed\u2019s dreamlike interiors with an early entry slot.', color: 'hsl(204 34% 61%)', lat: 41.3916, lon: 2.1650 },
  { id: 'activity-4', name: 'La Boqueria tasting walk', category: 'Food', area: 'La Rambla', length: '2 hours', price: 52, note: 'Market bites with a local food writer.', color: 'hsl(39 71% 65%)', lat: 41.3816, lon: 2.1722 },
  { id: 'activity-5', name: 'Barceloneta morning swim', category: 'Outdoors', area: 'Barceloneta', length: '1 hour', price: 0, note: 'An unhurried start before the beach gets lively.', color: 'hsl(175 45% 25%)', lat: 41.3784, lon: 2.1925 },
  { id: 'activity-6', name: 'Palau de la M\u00fasica', category: 'Culture', area: 'La Ribera', length: '75 minutes', price: 22, note: 'A small, ornate jewel of Catalan modernism.', color: 'hsl(14 58% 62%)', lat: 41.3875, lon: 2.1753 },
];
const nav = [
  { href: '/', label: 'Trip brief', icon: HomeIcon },
  { href: '/flights', label: 'Flights', icon: Plane },
  { href: '/stays', label: 'Stays', icon: BedDouble },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/itinerary', label: 'Itinerary', icon: CalendarDays },
  { href: '/budget', label: 'Budget', icon: WalletCards },
  { href: '/packing', label: 'Packing', icon: Backpack },
];

const airportCoords: Record<string, { lat: number; lon: number; name: string }> = {
  BCN: { lat: 41.2971, lon: 2.0785, name: 'Barcelona El Prat' },
  SFO: { lat: 37.6213, lon: -122.3790, name: 'San Francisco International' },
  CAI: { lat: 30.1219, lon: 31.4056, name: 'Cairo International' },
  CDG: { lat: 49.0097, lon: 2.5479, name: 'Paris Charles de Gaulle' },
  FCO: { lat: 41.8003, lon: 12.2389, name: 'Rome Fiumicino' },
  IST: { lat: 41.2753, lon: 28.7519, name: 'Istanbul Airport' },
  LHR: { lat: 51.4700, lon: -0.4543, name: 'London Heathrow' },
};

const tripGradients = [
  'linear-gradient(145deg, hsl(var(--primary)), hsl(14 58% 62%))',
  'linear-gradient(145deg, hsl(204 34% 61%), hsl(var(--primary)))',
  'linear-gradient(145deg, hsl(39 71% 65%), hsl(14 58% 62%))',
  'linear-gradient(145deg, hsl(101 28% 52%), hsl(var(--primary)))',
  'linear-gradient(145deg, hsl(14 58% 62%), hsl(204 34% 61%))',
];

/* ─── Utility Functions ──────────────────────────────────────────────────── */

function generateId() {
  return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(amount: number, currency: BudgetCurrency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function budgetStatus(total: number, budget: number): BudgetStatus {
  if (total <= budget) return 'Within Budget';
  if (total <= budget * 1.15) return 'Near Budget';
  return 'Over Budget';
}

function calculateNights(startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateWalkingTime(distKm: number): string {
  const minutes = Math.round((distKm / 5) * 60);
  return minutes < 60 ? `${minutes} min walk` : `${Math.round(minutes / 60)}h ${minutes % 60}m walk`;
}

function estimateTransitTime(distKm: number): string {
  const minutes = Math.round((distKm / 15) * 60);
  return minutes < 60 ? `${minutes} min transit` : `${Math.round(minutes / 60)}h ${minutes % 60}m transit`;
}

function parseDuration(length: string): number {
  if (length.includes('hour')) {
    const match = length.match(/([\d.]+)/);
    return match ? parseFloat(match[1]) * 60 : 90;
  }
  const match = length.match(/(\d+)/);
  return match ? parseInt(match[1]) : 90;
}

function autoAllocateRemaining(remaining: number): Omit<BudgetAllocation, 'flights' | 'accommodation'> {
  if (remaining <= 0) return { transportation: 0, food: 0, activities: 0, other: 0 };
  return {
    transportation: Math.round(remaining * 0.2),
    food: Math.round(remaining * 0.4),
    activities: Math.round(remaining * 0.3),
    other: Math.round(remaining * 0.1),
  };
}

function tripProgress(trip: Trip): number {
  let done = 0;
  if (trip.selectedFlight) done++;
  if (trip.selectedStay) done++;
  if (trip.savedActivities.length > 0) done++;
  if (trip.itinerary.length > 0) done++;
  if (trip.budget.amount > 0) done++;
  return Math.round((done / 5) * 100);
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(s)} \u2014 ${fmt(e)}`;
}

function generateItinerary(trip: Trip): ItineraryDay[] {
  const nights = calculateNights(trip.startDate, trip.endDate);
  const days: ItineraryDay[] = [];
  const saved = trip.savedActivities.map(id => activities.find(a => a.id === id)).filter(Boolean) as typeof activities;
  const selectedStay = stays.find(s => s.id === trip.selectedStay);
  const stayLat = selectedStay?.lat ?? 41.3851;
  const stayLon = selectedStay?.lon ?? 2.1834;
  const selectedFlight = flights.find(f => f.id === trip.selectedFlight);

  const sortedActivities = [...saved].sort((a, b) => {
    const distA = haversineDistance(stayLat, stayLon, a.lat, a.lon);
    const distB = haversineDistance(stayLat, stayLon, b.lat, b.lon);
    return distA - distB;
  });

  const activitiesPerDay = Math.max(1, Math.ceil(sortedActivities.length / Math.max(1, nights - 1)));
  let activityIndex = 0;

  for (let i = 0; i < nights; i++) {
    const date = new Date(trip.startDate + 'T12:00:00');
    date.setDate(date.getDate() + i);
    const dateStr = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const items: ItineraryItem[] = [];

    if (i === 0) {
      items.push({
        time: selectedFlight?.out ?? '14:00',
        name: `Arrive at ${trip.destination}`,
        note: selectedFlight ? `${selectedFlight.airline} \u00b7 ${selectedFlight.duration} \u00b7 ${selectedFlight.stops}` : 'Arrival',
        cost: 0,
        lat: airportCoords[trip.destinationCode]?.lat,
        lon: airportCoords[trip.destinationCode]?.lon,
      });
      items.push({
        time: '18:30',
        name: `Check in \u0026 explore nearby`,
        note: selectedStay ? `${selectedStay.name} \u00b7 settle in` : 'Check in to your accommodation',
        cost: 0,
        lat: stayLat,
        lon: stayLon,
      });
      items.push({
        time: '20:00',
        name: 'Dinner near the hotel',
        note: `First evening in ${trip.destination} \u00b7 demo estimate`,
        cost: 35,
        lat: stayLat + 0.002,
        lon: stayLon + 0.001,
      });
    } else if (i === nights - 1) {
      const remaining = sortedActivities.slice(activityIndex);
      if (remaining.length > 0) {
        const act = remaining[0];
        items.push({
          time: '09:00',
          name: act.name,
          note: `${act.area} \u00b7 ${act.price > 0 ? `$${act.price} demo estimate` : 'Free'}`,
          cost: act.price,
          lat: act.lat,
          lon: act.lon,
        });
      }
      items.push({
        time: '14:00',
        name: `Head to the airport`,
        note: `Depart from ${trip.destination}`,
        cost: 0,
        lat: airportCoords[trip.destinationCode]?.lat,
        lon: airportCoords[trip.destinationCode]?.lon,
      });
    } else {
      const dayActivities = sortedActivities.slice(activityIndex, activityIndex + activitiesPerDay);
      activityIndex += dayActivities.length;

      const clusterSorted = dayActivities.length > 1
        ? dayActivities.sort((a, b) => {
            const distA = haversineDistance(stayLat, stayLon, a.lat, a.lon);
            const distB = haversineDistance(stayLat, stayLon, b.lat, b.lon);
            return distA - distB;
          })
        : dayActivities;

      let currentHour = 9;
      for (const act of clusterSorted) {
        const hours = Math.floor(currentHour);
        const mins = Math.round((currentHour - hours) * 60);
        items.push({
          time: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
          name: act.name,
          note: `${act.area} \u00b7 ${act.length} \u00b7 ${act.price > 0 ? `$${act.price} demo estimate` : 'Free'}`,
          cost: act.price,
          lat: act.lat,
          lon: act.lon,
        });
        currentHour += parseDuration(act.length) / 60 + 0.5;
      }

      if (items.length > 0) {
        const lastTime = currentHour + 1;
        const lunchHours = Math.floor(lastTime > 13 ? 13 : lastTime);
        items.splice(Math.min(1, items.length), 0, {
          time: `${String(lunchHours).padStart(2, '0')}:00`,
          name: `Lunch in ${clusterSorted[0]?.area ?? trip.destination}`,
          note: 'Demo estimate',
          cost: 25,
        });
      }

      if (dayActivities.length === 0) {
        items.push({
          time: '10:00',
          name: `Free morning in ${trip.destination}`,
          note: 'No reservation required \u2014 the best kind',
          cost: 0,
        });
        items.push({
          time: '13:00',
          name: 'Lunch',
          note: 'Demo estimate',
          cost: 25,
        });
        items.push({
          time: '16:00',
          name: 'Explore the neighborhood',
          note: 'An unhurried afternoon',
          cost: 0,
        });
      }
    }

    const titles = ['Arrive \u0026 exhale', 'Old city, slow pace', 'Gaud\u00ed \u0026 a high view', 'A slower rhythm', 'Culture \u0026 color', 'Hidden corners', 'Final morning'];
    days.push({
      n: i + 1,
      date: dateStr,
      title: i === 0 ? titles[0] : i === nights - 1 ? titles[6] : titles[Math.min(i, titles.length - 2)],
      items,
    });
  }
  return days;
}

/* ─── Hooks ──────────────────────────────────────────────────────────────── */

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}

const defaultTrip: Trip = {
  id: 'trip-barcelona',
  name: 'Barcelona in full.',
  destination: 'Barcelona',
  destinationCode: 'BCN',
  origin: 'SFO',
  originCode: 'SFO',
  startDate: '2027-04-18',
  endDate: '2027-04-24',
  travelers: 2,
  budget: defaultBudget,
  budgetAllocation: { flights: 818, accommodation: 1284, transportation: 62, food: 382, activities: 116, other: 0 },
  selectedFlight: 'flight-2',
  selectedStay: 'stay-1',
  savedActivities: ['activity-1', 'activity-3'],
  selectedLivePlaces: [],
  itinerary: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const defaultTripStore: TripStore = {
  trips: [defaultTrip],
  currentTripId: 'trip-barcelona',
};

function useTripStore() {
  const [store, setStore] = useStored<TripStore>('travel-trips', defaultTripStore);

  const current = useMemo(() => store.trips.find(t => t.id === store.currentTripId) ?? store.trips[0] ?? defaultTrip, [store]);

  const updateTrip = useCallback((id: string, updates: Partial<Trip>) => {
    setStore(prev => ({
      ...prev,
      trips: prev.trips.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t),
    }));
  }, [setStore]);

  const setCurrent = useCallback((id: string) => {
    setStore(prev => ({ ...prev, currentTripId: id }));
  }, [setStore]);

  const createTrip = useCallback((trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = generateId();
    const full: Trip = { ...trip, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setStore(prev => ({ trips: [...prev.trips, full], currentTripId: id }));
    return id;
  }, [setStore]);

  const deleteTrip = useCallback((id: string) => {
    setStore(prev => {
      const remaining = prev.trips.filter(t => t.id !== id);
      const newCurrent = prev.currentTripId === id ? (remaining[0]?.id ?? '') : prev.currentTripId;
      return { trips: remaining, currentTripId: newCurrent };
    });
  }, [setStore]);

  const duplicateTrip = useCallback((id: string) => {
    setStore(prev => {
      const source = prev.trips.find(t => t.id === id);
      if (!source) return prev;
      const newId = generateId();
      const copy: Trip = { ...source, id: newId, name: `${source.name} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return { trips: [...prev.trips, copy], currentTripId: newId };
    });
  }, [setStore]);

  return { store, current, updateTrip, setCurrent, createTrip, deleteTrip, duplicateTrip };
}

/* ─── Shared Components ──────────────────────────────────────────────────── */

function TravelLogo() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6.5 17.5 12.8 6.4l4.7 8.1-8.8 1.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12.8" cy="6.4" r="2" fill="currentColor" /><circle cx="6.5" cy="17.5" r="1.5" fill="currentColor" /></svg></span>;
}

function BudgetControls({ budget, setBudget }: { budget: BudgetSettings; setBudget: (value: BudgetSettings) => void }) {
  const preset = budgetPresets.find(item => item.tier === budget.tier);
  return <div className="budget-controls">
    <label><span>Budget level</span><select value={budget.tier} onChange={event => {
      const tier = event.target.value as BudgetTier | 'Custom';
      const presetAmount = budgetPresets.find(item => item.tier === tier)?.amount;
      setBudget({ ...budget, tier, amount: presetAmount ?? budget.amount });
    }}><option value="Budget">Budget</option><option value="Economy">Economy</option><option value="Standard">Standard</option><option value="Premium">Premium</option><option value="Luxury">Luxury</option><option value="Custom">Custom budget</option></select></label>
    <label><span>My Budget</span><input type="number" min="0" step="50" value={budget.amount} onChange={event => setBudget({ ...budget, tier: 'Custom', amount: Math.max(0, Number(event.target.value) || 0) })} /></label>
    <label><span>Currency</span><select value={budget.currency} onChange={event => setBudget({ ...budget, currency: event.target.value as BudgetCurrency })}>{currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
    <div className="budget-control-note"><strong>{formatMoney(budget.amount, budget.currency)}</strong><span>{preset?.note ?? 'Set any amount and update it anytime.'}</span></div>
  </div>;
}

function AirportAutocomplete({ label, value, onChange }: { label: string; value: string; onChange: (value: string, city?: string) => void }) {
  const [focused, setFocused] = useState(false);
  const params = { q: value.trim(), limit: 6 };
  const airports = useQuery({ queryKey: ['airports', params.q], queryFn: () => fetchAirports(params.q), enabled: params.q.length >= 2, staleTime: 3600000 });
  return <label className="airport-autocomplete">{label}<input value={value} onFocus={() => setFocused(true)} onChange={event => onChange(event.target.value)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} placeholder="City, airport, or code" autoComplete="off" />
    {focused && value.trim().length >= 2 && airports.data?.airports.length ? <div className="airport-results">{airports.data.airports.map(airport => <button type="button" className="airport-result" key={airport.id} onMouseDown={() => onChange(airport.iataCode, airport.city)}><strong>{airport.city}, {airport.country}</strong><span>{airport.airportName}</span><small>{airport.iataCode}</small></button>)}</div> : null}
  </label>;
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-heading-actions">{actions}</div>}</div>;
}

/* ─── Leaflet Map ─────────────────────────────────────────────────────── */

function createDivIcon(className: string): L.DivIcon {
  return L.divIcon({ className: `map-custom-marker ${className}`, iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22] });
}

const stayIcon = createDivIcon('stay-marker');
const activityIcon = createDivIcon('activity-marker');
const airportIcon = createDivIcon('airport-marker');
const defaultMapIcon = createDivIcon('');

function MapRecenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lon], 13); }, [map, lat, lon]);
  return null;
}

type MapMarker = { lat: number; lon: number; label: string; type: 'stay' | 'activity' | 'airport' | 'default' };

function MapPanel({ markers = [], center, route }: { markers?: MapMarker[]; center?: { lat: number; lon: number }; route?: Array<[number, number]> }) {
  const c = center ?? (markers[0] ? { lat: markers[0].lat, lon: markers[0].lon } : { lat: 41.3851, lon: 2.1834 });
  const icons: Record<string, L.DivIcon> = { stay: stayIcon, activity: activityIcon, airport: airportIcon, default: defaultMapIcon };

  return <div className="map-panel" style={{ position: 'relative' }}>
    <MapContainer center={[c.lat, c.lon]} zoom={13} style={{ width: '100%', height: '100%', minHeight: 360, borderRadius: 15 }} scrollWheelZoom={false} zoomControl={true}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>' />
      <MapRecenter lat={c.lat} lon={c.lon} />
      {markers.map((m, i) => (
        <Marker key={`${m.label}-${i}`} position={[m.lat, m.lon]} icon={icons[m.type] ?? defaultMapIcon}>
          <Popup><strong>{m.label}</strong><span>{m.type === 'airport' ? 'Airport' : m.type === 'stay' ? 'Your stay' : 'Activity'}</span></Popup>
        </Marker>
      ))}
      {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: 'hsl(14, 58%, 62%)', weight: 3, dashArray: '8 6', opacity: 0.8 }} />}
    </MapContainer>
    <div className="map-legend"><span><i className="legend-dot" /> Your plan</span><span><i className="legend-dot" style={{ background: 'hsl(204 34% 61%)' }} /> Saved pick</span><span className="mono" style={{ marginLeft: 'auto', opacity: .65 }}>live coordinates</span></div>
  </div>;
}

/* ─── Pages ──────────────────────────────────────────────────────────────── */

function Home() {
  const [, setLocation] = useLocation();
  const { current, updateTrip } = useTripStore();
  const nights = calculateNights(current.startDate, current.endDate);
  const selectedFlight = flights.find(f => f.id === current.selectedFlight);
  const selectedStay = stays.find(s => s.id === current.selectedStay);
  const totalPlanned = current.budgetAllocation.flights + current.budgetAllocation.accommodation + current.budgetAllocation.transportation + current.budgetAllocation.food + current.budgetAllocation.activities + current.budgetAllocation.other;
  const progress = tripProgress(current);

  const [day, setDay] = useState(1);

  const itinerary = useMemo(() => {
    if (current.itinerary.length > 0) return current.itinerary;
    return generateItinerary(current);
  }, [current]);

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (selectedStay) m.push({ lat: selectedStay.lat, lon: selectedStay.lon, label: selectedStay.name, type: 'stay' });
    const currentDay = itinerary.find(d => d.n === day);
    if (currentDay) {
      for (const item of currentDay.items) {
        if (item.lat && item.lon) m.push({ lat: item.lat, lon: item.lon, label: item.name, type: item.name.includes('airport') || item.name.includes('Arrive') || item.name.includes('Head to') ? 'airport' : 'activity' });
      }
    }
    return m;
  }, [selectedStay, itinerary, day]);

  const route: Array<[number, number]> = useMemo(() => {
    const currentDay = itinerary.find(d => d.n === day);
    if (!currentDay) return [];
    const points: Array<[number, number]> = [];
    if (selectedStay) points.push([selectedStay.lat, selectedStay.lon]);
    for (const item of currentDay.items) {
      if (item.lat && item.lon) points.push([item.lat, item.lon]);
    }
    if (selectedStay && points.length > 1) points.push([selectedStay.lat, selectedStay.lon]);
    return points;
  }, [itinerary, day, selectedStay]);

  return <div className="page">
    <PageHeading eyebrow={`Trip Dashboard`} title={current.destination} description={`${formatDateRange(current.startDate, current.endDate)} \u00b7 ${nights} days \u00b7 ${current.travelers} travelers`} actions={<><button className="btn btn-quiet" onClick={() => setLocation('/trips')} data-testid="button-view-trips">View all trips <ArrowRight /></button></>} />
    
    <div className="grid grid-3" style={{ marginBottom: '24px' }}>
      <div className="card stat-card"><div className="stat-icon"><CircleDollarSign /></div><div><div className="stat-value">{formatMoney(totalPlanned, current.budget.currency)}</div><div className="stat-note">budget allocated</div></div></div>
      <div className="card stat-card"><div className="stat-icon"><CloudSun /></div><div><div className="stat-value">20\u00b0</div><div className="stat-note">typical daytime high</div></div></div>
      <div className="card next-card card-pad"><div className="next-date"><strong>{new Date(current.startDate + 'T12:00:00').getDate()}</strong><span>{new Date(current.startDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' })}</span></div><div><h3>Next up: fly to {current.destination}</h3><p>{selectedFlight ? `${selectedFlight.airline} \u00b7 ${current.originCode} \u2192 ${current.destinationCode}` : 'Select a flight'}</p></div><ChevronRight size={17} className="muted" /></div>
    </div>

    <div className="section-label"><h2>Trip Itinerary & Map</h2></div>
    <div style={{ display: 'flex', gap: 7, overflow: 'auto', margin: '17px 0 14px' }}>{itinerary.map(d => <button key={d.n} className={`filter-pill ${day === d.n ? 'active' : ''}`} onClick={() => setDay(d.n)} data-testid={`button-day-${d.n}`}>Day {d.n} \u00b7 {d.date.slice(0, 3)}</button>)}</div>
    <div className="itinerary-layout"><div className="grid">{itinerary.filter(d => d.n === day).map(d => <div className="card timeline-day" key={d.n}><div className="day-head"><div className="day-number"><div className="day-index">{String(d.n).padStart(2, '0')}</div><div><h3>{d.title}</h3><p>{d.date} \u00b7 {current.destination}</p></div></div><CloudSun size={19} className="muted" /></div><div className="timeline">{d.items.map((item, index) => { const nextItem = d.items[index + 1]; const dist = item.lat && item.lon && nextItem?.lat && nextItem?.lon ? haversineDistance(item.lat, item.lon, nextItem.lat, nextItem.lon) : 0; return <div className="timeline-item" key={`${item.time}-${index}`}><div className="timeline-dot" /><div className="time">{item.time}</div><div className="timeline-copy"><h4>{item.name}</h4><p>{item.note}</p>{item.cost > 0 && <span className="cost">${item.cost}</span>}{dist > 0.1 && <p style={{ marginTop: 4, fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>\u2192 {dist < 2 ? estimateWalkingTime(dist) : estimateTransitTime(dist)} ({dist.toFixed(1)} km)</p>}</div></div>; })}</div></div>)}</div><MapPanel markers={markers} route={route} /></div>
  </div>;
}

function Flights() {
  const { current, updateTrip } = useTripStore();
  const nights = calculateNights(current.startDate, current.endDate);
  const [search, setSearch] = useState({ origin: current.origin || 'SFO', destination: current.destination || 'Barcelona', departureDate: current.startDate, returnDate: current.endDate, travelers: current.travelers });
  const [submitted, setSubmitted] = useState(search);
  const links = useQuery({ queryKey: ['links', submitted], queryFn: () => fetchSearchLinks(submitted), staleTime: 300000 });
  const weatherParams = { city: submitted.destination, startDate: submitted.departureDate, endDate: submitted.returnDate };
  const weather = useQuery({ queryKey: ['weather', weatherParams.city], queryFn: () => fetchWeather(weatherParams.city), staleTime: 300000 });
  const exchange = useQuery({ queryKey: ['exchange', current.budget.currency], queryFn: () => fetchExchangeRate('USD', current.budget.currency), staleTime: 3600000 });
  const rate = current.budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 1;

  const selectFlight = (flightId: string) => {
    const flight = flights.find(f => f.id === flightId);
    const flightCost = flight ? flight.price * current.travelers : 0;
    const remaining = current.budget.amount - flightCost - current.budgetAllocation.accommodation;
    const auto = autoAllocateRemaining(remaining);
    updateTrip(current.id, {
      selectedFlight: flightId,
      budgetAllocation: { ...current.budgetAllocation, flights: flightCost, ...auto },
    });
  };

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted({ ...search });
  };

  const flightBudget = current.budget.amount * 0.47;

  return <div className="page"><PageHeading eyebrow="Getting there" title="Find your way in." description="Search your route with live provider links, then keep the planning decisions here." actions={<button className="btn btn-quiet" onClick={() => links.data?.flightSearchUrl && window.open(links.data.flightSearchUrl, '_blank')} data-testid="link-external-flight-search"><ExternalLink /> Compare live fares</button>} />
    <form className="card live-search" onSubmit={submitSearch}>
      <div className="live-search-heading"><div><div className="eyebrow">Live search handoff</div><h3>Search your real route</h3></div><span className="live-chip">No API key required</span></div>
      <div className="search-fields">
        <AirportAutocomplete label="From" value={search.origin} onChange={(v, city) => setSearch({ ...search, origin: v })} />
        <AirportAutocomplete label="To" value={search.destination} onChange={(v, city) => setSearch({ ...search, destination: v })} />
        <label>Depart<input type="date" value={search.departureDate} onChange={event => setSearch({ ...search, departureDate: event.target.value })} /></label>
        <label>Return<input type="date" value={search.returnDate} onChange={event => setSearch({ ...search, returnDate: event.target.value })} /></label>
        <label>Travelers<input type="number" min="1" max="12" value={search.travelers} onChange={event => setSearch({ ...search, travelers: Number(event.target.value) || 1 })} /></label>
        <button className="btn btn-primary" type="submit"><Search /> Search</button>
      </div>
      <BudgetControls budget={current.budget} setBudget={b => updateTrip(current.id, { budget: b })} />
      {links.data && <div className="provider-links"><a className="external" href={links.data.flightSearchUrl} target="_blank" rel="noreferrer">Open live flights <ExternalLink size={12} /></a><a className="external" href={links.data.accommodationSearchUrl} target="_blank" rel="noreferrer">Open live stays <ExternalLink size={12} /></a></div>}
    </form>
    <div className="notice"><Info /><span>TraveL&amp; uses live provider searches for current fares. This app does not invent prices, take payment, or confirm bookings.</span></div>
    {weather.data && <div className="card live-weather"><div><div className="eyebrow">Destination outlook \u00b7 {weather.data.city}</div><strong>{weather.data.days[0] ? `${Math.round(weather.data.days[0].minC)}\u2013${Math.round(weather.data.days[0].maxC)}\u00b0C` : 'Forecast not available yet'}</strong><span>{weather.data.note ?? `from Open-Meteo \u00b7 refreshed ${new Date(weather.data.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span></div>{weather.data.days.length > 0 && <div className="weather-days">{weather.data.days.slice(0, 4).map(day => <span key={day.date}><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</b>{Math.round(day.maxC)}\u00b0 \u00b7 {day.precipitationProbability}% rain</span>)}</div>}</div>}
    <div className="card" style={{ marginTop: 15 }}><div className="route-card"><div className="route-city"><span>From</span><strong>{submitted.origin.toUpperCase().slice(0, 3)}</strong><span>{submitted.origin}</span></div><div className="route-line" /><div className="route-city" style={{ textAlign: 'right' }}><span>To</span><strong>{submitted.destination.toUpperCase().slice(0, 3)}</strong><span>{submitted.destination}</span></div></div>{flights.map(flight => { const totalCost = flight.price * current.travelers; const converted = totalCost * rate; const status = budgetStatus(converted, flightBudget * rate); return <div className={`flight-row ${current.selectedFlight === flight.id ? 'selected' : ''}`} key={flight.id}><div className="flight-main"><div className="airline-mark">{flight.code}</div><div><div className="flight-times"><strong>{flight.out}</strong><span className="dash" /><strong>{flight.back}</strong></div><div className="flight-meta">{flight.airline} \u00b7 {flight.duration} \u00b7 {flight.stops}</div></div></div><div className="flight-price"><strong>{formatMoney(totalCost, 'USD')}</strong><span>{current.travelers > 1 ? `for ${current.travelers} \u00b7 ` : ''}demo only</span></div><span className="option-tag">{status}</span><button className={`btn ${current.selectedFlight === flight.id ? 'btn-accent' : 'btn-quiet'}`} onClick={() => selectFlight(flight.id)} data-testid={`button-select-${flight.id}`}>{current.selectedFlight === flight.id ? <><Check /> Selected</> : 'Select'}</button></div>; })}</div>
    <div className="section-label"><h2>Good to know</h2></div><div className="grid grid-3"><div className="card card-pad"><div className="eyebrow">Timing</div><h3 style={{ margin: '9px 0 5px' }}>Arrive with daylight</h3><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>An afternoon arrival gives you time to check in and walk the city.</p></div><div className="card card-pad"><div className="eyebrow">Handoff</div><h3 style={{ margin: '9px 0 5px' }}>Book direct when ready</h3><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>TraveL&amp; will hand you off to the airline. It never handles payment or booking.</p></div><div className="card card-pad"><div className="eyebrow">Flexibility</div><h3 style={{ margin: '9px 0 5px' }}>Hold a backup</h3><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>Keep a second option in mind if arrival time matters more than fare.</p></div></div>
  </div>;
}

function Stays() {
  const { current, updateTrip } = useTripStore();
  const nights = calculateNights(current.startDate, current.endDate);
  const exchange = useQuery({ queryKey: ['exchange', current.budget.currency], queryFn: () => fetchExchangeRate('USD', current.budget.currency), staleTime: 3600000 });
  const rate = current.budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 1;
  const [city, setCity] = useState(current.destination || 'Barcelona');
  const [submittedCity, setSubmittedCity] = useState(current.destination || 'Barcelona');
  const [propertyType, setPropertyType] = useState('lodging');
  const propertyTypes = [{ value: 'lodging', label: 'All' }, { value: 'hotel', label: 'Hotel' }, { value: 'motel', label: 'Motel' }, { value: 'hostel', label: 'Hostel' }, { value: 'apartment', label: 'Apartment' }, { value: 'guest_house', label: 'Guesthouse' }];
  const placesParams = { city: submittedCity, kind: propertyType, limit: 12 };
  const places = useQuery({ queryKey: ['places', placesParams.city, placesParams.kind], queryFn: () => fetchPlaces(placesParams.city, placesParams.kind), staleTime: 300000 });
  const [submitted, setSubmitted] = useState({ origin: current.origin || 'SFO', destination: current.destination || 'Barcelona', departureDate: current.startDate, returnDate: current.endDate, travelers: current.travelers });
  const links = useQuery({ queryKey: ['links', submitted], queryFn: () => fetchSearchLinks(submitted), staleTime: 300000 });

  const accBudget = current.budget.amount * 0.37;

  const selectStay = (stayId: string) => {
    const stay = stays.find(s => s.id === stayId);
    const accCost = stay ? stay.price * nights : 0;
    const remaining = current.budget.amount - current.budgetAllocation.flights - accCost;
    const auto = autoAllocateRemaining(remaining);
    updateTrip(current.id, {
      selectedStay: stayId,
      budgetAllocation: { ...current.budgetAllocation, accommodation: accCost, ...auto },
    });
  };

  const submitCity = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const c = city.trim() || 'Barcelona';
    setSubmittedCity(c);
    setSubmitted({ ...submitted, destination: c });
  };

  return <div className="page"><PageHeading eyebrow="A place to land" title="Stay somewhere with a pulse." description="Find real hotels, motels, hostels, and guest houses from OpenStreetMap, then verify price and availability with a provider." actions={<button className="btn btn-primary" onClick={() => links.data?.accommodationSearchUrl && window.open(links.data.accommodationSearchUrl, '_blank')} data-testid="link-external-stay-search">Search live availability <ExternalLink /></button>} />
    <form className="card live-search" onSubmit={submitCity}>
      <div className="live-search-heading"><div><div className="eyebrow">Free place discovery</div><h3>Find lodging in any city</h3></div><span className="live-chip">OpenStreetMap</span></div>
      <div className="search-fields lodging-fields"><label>Destination city<input value={city} onChange={event => setCity(event.target.value)} placeholder="Barcelona, Cairo, Rome..." /></label><button className="btn btn-primary" type="submit"><Search /> Find places</button></div>
      <div className="filters" style={{ marginTop: 14 }}>{propertyTypes.map(pt => <button key={pt.value} type="button" className={`filter-pill ${propertyType === pt.value ? 'active' : ''}`} onClick={() => setPropertyType(pt.value)}>{pt.label}</button>)}</div>
      {links.data && <div className="provider-links"><a className="external" href={links.data.accommodationSearchUrl} target="_blank" rel="noreferrer">Check live rooms and prices <ExternalLink size={12} /></a></div>}
    </form>
    <div className="notice"><Info /><span>Place names and map links are live from OpenStreetMap. This free source does not provide room prices, ratings, or availability, so those fields stay blank instead of being fabricated.</span></div>
    {places.isLoading && <div className="card card-pad loading-card">Finding lodging around {submittedCity}\u2026</div>}
    {places.data && <><div className="section-label"><h2>Live places around {places.data.city}</h2><span className="eyebrow">Retrieved {new Date(places.data.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="option-grid grid" style={{ marginTop: 15 }}>{places.data.places.map(place => <div className="card option-card live-place-card" key={place.id}><div className="option-card-body"><div className="option-top"><div><h3>{place.name}</h3><p>{place.category} \u00b7 {place.address ?? 'Address not listed'}</p></div><span className="option-tag">{place.category === 'hotel' ? 'Hotel' : place.category === 'motel' ? 'Motel' : place.category === 'hostel' ? 'Hostel' : place.category === 'guest_house' ? 'Guesthouse' : place.category === 'apartment' ? 'Apartment' : 'Live place'}</span></div><div className="option-details"><div><span>Price</span><strong>Not provided</strong></div><div><span>Availability</span><strong>Verify direct</strong></div></div><div className="option-footer"><a className="external" href={place.mapLink} target="_blank" rel="noreferrer">Map <ExternalLink size={11} /></a>{place.website ? <a className="external" href={place.website} target="_blank" rel="noreferrer">Website <ExternalLink size={11} /></a> : <span className="muted">No website listed</span>}</div></div></div>)}</div></>}
    {places.isError && <div className="notice"><Info /><span>OpenStreetMap is unavailable right now. You can still search current rooms and prices through the provider link above.</span></div>}
    <div className="section-label"><h2>Planning examples</h2><span className="eyebrow">Demo only</span></div><div className="option-grid grid" style={{ marginTop: 15 }}>{stays.map(stay => { const totalCost = stay.price * nights; const converted = totalCost * rate; const status = budgetStatus(converted, accBudget * rate); return <div className={`card option-card ${current.selectedStay === stay.id ? 'selected' : ''}`} key={stay.id}><div className="option-card-body"><div className="option-top"><div><h3>{stay.name}</h3><p>{stay.area}</p></div><span className="option-tag">{current.selectedStay === stay.id ? 'Your choice' : status}</span></div><div style={{ marginTop: 16, height: 84, borderRadius: 9, background: `linear-gradient(135deg, hsl(var(--primary) / .9), ${stay.id === 'stay-1' ? 'hsl(14 58% 62% / .8)' : stay.id === 'stay-2' ? 'hsl(204 34% 61% / .8)' : 'hsl(39 71% 65% / .75)'})`, position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', inset: '32px 0 0', background: 'hsl(var(--card) / .18)', clipPath: 'polygon(0 40%, 27% 0, 55% 45%, 74% 14%, 100% 55%, 100% 100%, 0 100%)' }} /><span style={{ position: 'absolute', right: 10, top: 10, color: 'hsl(40 38% 97% / .8)', fontSize: 10 }}>{stay.rating} / 10</span></div><p style={{ marginTop: 14 }}>{stay.note}</p><div className="option-details"><div><span>From</span><strong>${stay.price}<small className="muted"> / night</small></strong></div><div><span>Total ({nights} nights)</span><strong>{formatMoney(totalCost, 'USD')}</strong></div></div><div className="option-footer"><a className="external" href="https://www.booking.com" target="_blank" rel="noreferrer" data-testid={`link-provider-${stay.id}`}>Provider handoff <ExternalLink size={11} /></a><button className={`btn ${current.selectedStay === stay.id ? 'btn-accent' : 'btn-quiet'}`} onClick={() => selectStay(stay.id)} data-testid={`button-select-${stay.id}`}>{current.selectedStay === stay.id ? <><Check /> Selected</> : 'Choose stay'}</button></div></div></div>; })}</div>
  </div>;
}

function Explore() {
  const { current, updateTrip } = useTripStore();
  const exchange = useQuery({ queryKey: ['exchange', current.budget.currency], queryFn: () => fetchExchangeRate('USD', current.budget.currency), staleTime: 3600000 });
  const rate = current.budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 1;
  const [filter, setFilter] = useState('All');
  const visible = filter === 'All' ? activities : activities.filter(a => a.category === filter);
  const categories = ['All', 'Culture', 'Outdoors', 'Architecture', 'Food'];

  const toggleActivity = (actId: string) => {
    const isSaved = current.savedActivities.includes(actId);
    const newSaved = isSaved ? current.savedActivities.filter(id => id !== actId) : [...current.savedActivities, actId];
    const totalActivitiesCost = activities.filter(a => newSaved.includes(a.id)).reduce((sum, a) => sum + a.price, 0);
    updateTrip(current.id, {
      savedActivities: newSaved,
      budgetAllocation: { ...current.budgetAllocation, activities: totalActivitiesCost },
    });
  };

  return <div className="page"><PageHeading eyebrow="Make room for wonder" title="A city worth getting lost in." description="Save what catches your eye. We\u2019ll keep it close to the right day without turning your trip into a checklist." actions={<Link href="/itinerary" className="btn btn-primary" data-testid="button-explore-itinerary">View your picks <ArrowRight /></Link>} />
    <div className="filters">{categories.map(item => <button key={item} className={`filter-pill ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)} data-testid={`button-filter-${item.toLowerCase()}`}>{item}</button>)}</div>
    <div className="option-grid grid">{visible.map(activity => { const isSaved = current.savedActivities.includes(activity.id); const amount = activity.price; const status = amount && rate ? budgetStatus(amount * rate, current.budget.amount * .08 * rate) : null; return <div className={`card option-card ${isSaved ? 'selected' : ''}`} key={activity.id}><div style={{ height: 102, background: `linear-gradient(140deg, ${activity.color}, hsl(var(--primary) / .86))`, position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', width: 150, height: 150, border: '1px solid hsl(40 38% 97% / .28)', borderRadius: '50%', right: -20, top: -55 }} /><div style={{ position: 'absolute', left: 17, bottom: 12, color: 'hsl(40 38% 97% / .84)', fontFamily: 'var(--app-font-mono)', fontSize: 10 }}>{activity.category} / {current.destinationCode || 'BCN'}</div></div><div className="option-card-body"><div className="option-top"><div><h3>{activity.name}</h3><p>{activity.area} \u00b7 {activity.length}</p></div><button className="tiny-btn" aria-label={isSaved ? 'Remove saved activity' : 'Save activity'} onClick={() => toggleActivity(activity.id)} data-testid={`button-save-${activity.id}`}>{isSaved ? <Heart fill="currentColor" /> : <Heart />}</button></div><p style={{ marginTop: 13 }}>{activity.note}</p><div className="option-footer" style={{ marginTop: 15 }}><span className="mono" style={{ fontSize: 10 }}>{activity.price > 0 ? `$${activity.price}` : 'Free'} <span className="muted">demo estimate</span></span><span className="option-tag">{status ?? (isSaved ? <><Check size={10} style={{ verticalAlign: 'middle' }} /> Saved</> : 'Demo pick')}</span></div></div></div>; })}</div>
    <div className="section-label"><h2>One local note</h2></div><div className="card card-pad"><div className="notice" style={{ background: 'transparent', padding: 0 }}><Sparkles /><span>{current.destination} rewards a little restraint. Keep one afternoon open for a neighborhood you didn\u2019t plan to visit.</span></div></div>
  </div>;
}

function Itinerary() {
  const { current, updateTrip } = useTripStore();
  const [day, setDay] = useState(1);
  const selectedStay = stays.find(s => s.id === current.selectedStay);

  const itinerary = useMemo(() => {
    if (current.itinerary.length > 0) return current.itinerary;
    return generateItinerary(current);
  }, [current]);

  const regenerate = () => {
    const newItinerary = generateItinerary(current);
    updateTrip(current.id, { itinerary: newItinerary });
  };

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (selectedStay) m.push({ lat: selectedStay.lat, lon: selectedStay.lon, label: selectedStay.name, type: 'stay' });
    const currentDay = itinerary.find(d => d.n === day);
    if (currentDay) {
      for (const item of currentDay.items) {
        if (item.lat && item.lon) m.push({ lat: item.lat, lon: item.lon, label: item.name, type: item.name.includes('airport') || item.name.includes('Arrive') || item.name.includes('Head to') ? 'airport' : 'activity' });
      }
    }
    return m;
  }, [selectedStay, itinerary, day]);

  const route: Array<[number, number]> = useMemo(() => {
    const currentDay = itinerary.find(d => d.n === day);
    if (!currentDay) return [];
    const points: Array<[number, number]> = [];
    if (selectedStay) points.push([selectedStay.lat, selectedStay.lon]);
    for (const item of currentDay.items) {
      if (item.lat && item.lon) points.push([item.lat, item.lon]);
    }
    if (selectedStay && points.length > 1) points.push([selectedStay.lat, selectedStay.lon]);
    return points;
  }, [itinerary, day, selectedStay]);

  const exportItinerary = () => {
    const lines = [`TRAVEL& / ${current.destination.toUpperCase()} IN FULL`, `${formatDateRange(current.startDate, current.endDate)} \u00b7 ${calculateNights(current.startDate, current.endDate)} nights \u00b7 ${current.travelers} travelers`, ''];
    for (const d of itinerary) {
      lines.push(`DAY ${String(d.n).padStart(2, '0')} \u2014 ${d.title.toUpperCase()}`);
      for (const item of d.items) {
        lines.push(`${item.time}  ${item.name} \u00b7 ${item.note}${item.cost > 0 ? ` \u00b7 $${item.cost}` : ''}`);
      }
      lines.push('');
    }
    const totalCost = current.budgetAllocation.flights + current.budgetAllocation.accommodation + current.budgetAllocation.transportation + current.budgetAllocation.food + current.budgetAllocation.activities + current.budgetAllocation.other;
    lines.push(`ESTIMATED TRIP TOTAL: ${formatMoney(totalCost, current.budget.currency)} for ${current.travelers} travelers`);
    lines.push('All prices and availability are demo estimates. TraveL& does not book travel. Verify details with the provider before purchase.');
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `travel-${current.destination.toLowerCase()}-itinerary.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="page"><PageHeading eyebrow="The shape of your days" title="A plan with breathing room." description={`${itinerary.length} days of anchors and space. Your saved places will find their way here as the plan settles.`} actions={<><button className="btn btn-quiet" onClick={regenerate} data-testid="button-regenerate-itinerary"><Sparkles /> Regenerate</button><button className="btn btn-accent" onClick={exportItinerary} data-testid="button-export-itinerary"><FileDown /> Export itinerary</button></>} />
    <div className="notice"><Info /><span>Route distances and costs are planning estimates. Venue links are provider handoffs \u2014 TraveL&amp; does not book or confirm anything.</span></div>
    <div style={{ display: 'flex', gap: 7, overflow: 'auto', margin: '17px 0 14px' }}>{itinerary.map(d => <button key={d.n} className={`filter-pill ${day === d.n ? 'active' : ''}`} onClick={() => setDay(d.n)} data-testid={`button-day-${d.n}`}>Day {d.n} \u00b7 {d.date.slice(0, 3)}</button>)}</div>
    <div className="itinerary-layout"><div className="grid">{itinerary.filter(d => d.n === day).map(d => <div className="card timeline-day" key={d.n}><div className="day-head"><div className="day-number"><div className="day-index">{String(d.n).padStart(2, '0')}</div><div><h3>{d.title}</h3><p>{d.date} \u00b7 {current.destination}</p></div></div><CloudSun size={19} className="muted" /></div><div className="timeline">{d.items.map((item, index) => { const nextItem = d.items[index + 1]; const dist = item.lat && item.lon && nextItem?.lat && nextItem?.lon ? haversineDistance(item.lat, item.lon, nextItem.lat, nextItem.lon) : 0; return <div className="timeline-item" key={`${item.time}-${index}`}><div className="timeline-dot" /><div className="time">{item.time}</div><div className="timeline-copy"><h4>{item.name}</h4><p>{item.note}</p>{item.cost > 0 && <span className="cost">${item.cost}</span>}{dist > 0.1 && <p style={{ marginTop: 4, fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>\u2192 {dist < 2 ? estimateWalkingTime(dist) : estimateTransitTime(dist)} ({dist.toFixed(1)} km)</p>}</div></div>; })}</div></div>)}<div className="card card-pad"><div className="eyebrow">Saved for later</div><h3 style={{ fontFamily: 'var(--app-font-serif)', fontWeight: 500, margin: '8px 0 13px' }}>{current.savedActivities.length} saved experience{current.savedActivities.length !== 1 ? 's' : ''}</h3><p className="muted" style={{ fontSize: 11, lineHeight: 1.45 }}>You can keep these loose, or add one to a day when the weather feels right.</p><Link href="/explore" className="btn btn-quiet" style={{ marginTop: 13 }} data-testid="button-manage-picks">Manage picks <ArrowRight /></Link></div></div><MapPanel markers={markers} route={route} /></div>
  </div>;
}

function Budget() {
  const { current, updateTrip } = useTripStore();
  const nights = calculateNights(current.startDate, current.endDate);
  const rateQuery = { from: 'USD', to: current.budget.currency };
  const exchange = useQuery({ queryKey: ['exchange', current.budget.currency], queryFn: () => fetchExchangeRate('USD', current.budget.currency), staleTime: 3600000 });
  const rate = current.budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 1;

  const alloc = current.budgetAllocation;
  const totalUsd = alloc.flights + alloc.accommodation + alloc.transportation + alloc.food + alloc.activities + alloc.other;
  const total = totalUsd * rate;
  const budgetConverted = current.budget.amount;
  const status = budgetStatus(total, budgetConverted * rate);
  const remaining = budgetConverted - totalUsd;
  const isOver = remaining < 0;
  const progress = Math.min(100, (totalUsd / Math.max(1, budgetConverted)) * 100);

  const displayEstimate = (amount: number) => formatMoney(amount * rate, current.budget.currency);

  const handleBudgetChange = (b: BudgetSettings) => {
    const rem = b.amount - alloc.flights - alloc.accommodation;
    const auto = autoAllocateRemaining(rem);
    updateTrip(current.id, { budget: b, budgetAllocation: { ...alloc, ...auto } });
  };

  const updateCategory = (key: 'transportation' | 'food' | 'activities' | 'other', value: number) => {
    updateTrip(current.id, { budgetAllocation: { ...alloc, [key]: Math.max(0, value) } });
  };

  const selectedFlight = flights.find(f => f.id === current.selectedFlight);
  const selectedStay = stays.find(s => s.id === current.selectedStay);

  const breakdownRows = [
    { key: 'flights' as const, label: 'Flights', amount: alloc.flights, icon: Plane, note: selectedFlight ? `${selectedFlight.airline} \u00b7 ${current.travelers} traveler${current.travelers > 1 ? 's' : ''} \u00b7 demo estimate` : 'No flight selected', editable: false },
    { key: 'accommodation' as const, label: 'Accommodation', amount: alloc.accommodation, icon: BedDouble, note: selectedStay ? `${selectedStay.name} \u00b7 ${nights} nights \u00b7 demo estimate` : 'No stay selected', editable: false },
    { key: 'transportation' as const, label: 'Transportation', amount: alloc.transportation, icon: TrainFront, note: 'Metro, airport transfer, walking \u00b7 editable', editable: true },
    { key: 'food' as const, label: 'Food & coffee', amount: alloc.food, icon: Utensils, note: 'Daily estimate \u00b7 editable', editable: true },
    { key: 'activities' as const, label: 'Activities', amount: alloc.activities, icon: Landmark, note: `${current.savedActivities.length} saved \u00b7 editable`, editable: true },
    { key: 'other' as const, label: 'Other', amount: alloc.other, icon: CircleDollarSign, note: 'Buffer \u00b7 editable', editable: true },
  ];

  return <div className="page"><PageHeading eyebrow="Keep the shape, not the stress" title="A budget that leaves room." description="Set a ceiling, see the estimate against it, and keep every recommendation tied to the same number." actions={<button className="btn btn-quiet" onClick={() => { navigator.clipboard?.writeText(`${formatMoney(total, current.budget.currency)} estimated total \u00b7 ${current.destination}`); }} data-testid="button-copy-budget"><Share2 /> Copy summary</button>} />
    <div className="card card-pad budget-editor"><div className="section-label"><h2>Your trip budget</h2><span className="eyebrow">Updates everywhere</span></div><BudgetControls budget={current.budget} setBudget={handleBudgetChange} /></div>
    <div className="budget-layout"><div className="budget-hero"><div className="eyebrow budget-hero-label">Estimated trip total</div><div className="budget-total">{displayEstimate(totalUsd)}</div><div className="budget-note">for {current.travelers} traveler{current.travelers > 1 ? 's' : ''} \u00b7 {nights} nights \u00b7 {current.budget.currency}</div><div style={{ marginTop: 15 }}><div className="budget-progress-copy"><span>{status}</span><span>{formatMoney(budgetConverted, current.budget.currency)} budget</span></div><div className="budget-track" style={{ marginTop: 8 }}><span style={{ width: `${progress}%` }} /></div></div>{isOver && <div className="notice" style={{ marginTop: 12, background: 'hsl(var(--destructive) / .15)', borderColor: 'hsl(var(--destructive) / .4)', color: 'hsl(var(--destructive))' }}><Info /><span>Over budget by {formatMoney(Math.abs(remaining) * rate, current.budget.currency)}. Reduce category spending or increase your total budget.</span></div>}<div className="notice budget-hero-note"><Info /><span>Prices are demo estimates, not live offers. Verify current fares, cancellation terms, availability, and exchange rates with each provider.</span></div></div><div className="card card-pad">{breakdownRows.map(row => { const Icon = row.icon; const pct = Math.min(100, (row.amount / Math.max(1, budgetConverted)) * 100); return <div className={`budget-row ${isOver ? 'budget-over' : ''}`} key={row.key}><div className="budget-icon"><Icon /></div><div className="budget-row-main"><strong>{row.label}</strong><span>{row.note}</span><div className="bar-track"><span style={{ width: `${pct}%` }} /></div></div><div className="budget-amount">{row.editable ? <div className="budget-editable"><span>$</span><input type="number" min="0" step="10" value={row.amount} onChange={e => updateCategory(row.key as 'transportation' | 'food' | 'activities' | 'other', Number(e.target.value) || 0)} /></div> : displayEstimate(row.amount)}</div></div>; })}<div className="budget-row" style={{ borderBottom: 0, fontWeight: 600 }}><div className="budget-icon" style={{ background: isOver ? 'hsl(var(--destructive) / .2)' : 'hsl(var(--accent) / .25)' }}><WalletCards /></div><div className="budget-row-main"><strong>Remaining</strong><span>{isOver ? 'Over budget' : 'Available to spend'}</span></div><div className={`budget-amount ${isOver ? 'budget-over' : ''}`} style={{ fontWeight: 700 }}>{displayEstimate(remaining)}</div></div></div></div>
    <div className="section-label"><h2>Daily rhythm</h2><span className="eyebrow">demo estimate</span></div><div className="grid grid-3">{Array.from({ length: Math.min(3, calculateNights(current.startDate, current.endDate)) }, (_, i) => { const dayBudget = Math.round(totalUsd / Math.max(1, calculateNights(current.startDate, current.endDate))); return <div className="card card-pad" key={i}><div className="eyebrow">Day {i + 1}</div><div className="serif" style={{ fontSize: 25, marginTop: 8 }}>{displayEstimate(dayBudget)}</div><div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{['Arrival', 'Exploring', 'Adventure'][i % 3]}</div></div>; })}</div>
  </div>;
}

function Packing() {
  const [checked, setChecked] = useStored<string[]>('tripwise-packing', []);
  const { current } = useTripStore();
  const groups = [{ name: 'Documents & essentials', items: ['Passport + a photo of it', 'Travel insurance details', 'eSIM / roaming plan', 'A small crossbody bag'] }, { name: 'Clothing', items: ['Light jacket for evenings', 'Comfortable walking shoes', 'One smart-casual dinner look', 'Swimwear'] }, { name: 'The small comforts', items: ['Refillable water bottle', 'SPF 30+ and sunglasses', 'Foldable tote for market mornings', 'Universal adapter'] }, { name: 'Activity-ready', items: ['Compact daypack', 'Headphones for the flight', 'Packable rain layer', 'A little room for ceramics'] }];
  const toggle = (item: string) => setChecked(checked.includes(item) ? checked.filter(x => x !== item) : [...checked, item]);
  const nights = calculateNights(current.startDate, current.endDate);
  return <div className="page"><PageHeading eyebrow="Pack with intention" title="Less luggage. More room." description={`A gentle starting list for ${nights} days in ${current.destination}. Check things off and your list will be here when you return.`} actions={<button className="btn btn-quiet" onClick={() => setChecked([])} data-testid="button-reset-packing">Reset list</button>} />
    <div className="notice"><Backpack /><span>{checked.length} of {groups.reduce((sum, group) => sum + group.items.length, 0)} packed. Keep a little space \u2014 {current.destination} has a way of sending people home with something beautiful.</span></div>
    <div className="pack-grid grid" style={{ marginTop: 15 }}>{groups.map(group => <div className="card pack-category" key={group.name}><h3>{group.name}</h3>{group.items.map(item => <div className="check-row" key={item}><input type="checkbox" checked={checked.includes(item)} onChange={() => toggle(item)} id={item} data-testid={`checkbox-${item.toLowerCase().replaceAll(' ', '-')}`} /><label htmlFor={item}>{item}</label></div>)}</div>)}</div>
  </div>;
}

function Trips() {
  const [, setLocation] = useLocation();
  const { store, current, setCurrent, createTrip, deleteTrip, duplicateTrip } = useTripStore();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', destination: '', origin: '', startDate: '', endDate: '', travelers: 2, budgetTier: 'Standard' as BudgetTier | 'Custom', budgetAmount: 3500, budgetCurrency: 'USD' as BudgetCurrency });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.destination.trim()) return;
    const preset = budgetPresets.find(p => p.tier === form.budgetTier);
    const budgetAmount = preset?.amount ?? form.budgetAmount;
    setPlans(calculatePlans(budgetAmount));
  };

  const [plans, setPlans] = useState<{name: string, description: string, budgetAllocation: BudgetAllocation}[] | null>(null);

  const calculatePlans = (budget: number) => {
    return [
      { name: 'Optimal', description: 'Balanced focus on all aspects', budgetAllocation: { flights: Math.floor(budget * 0.3), accommodation: Math.floor(budget * 0.35), transportation: Math.floor(budget * 0.05), food: Math.floor(budget * 0.15), activities: budget - Math.floor(budget * 0.3) - Math.floor(budget * 0.35) - Math.floor(budget * 0.05) - Math.floor(budget * 0.15), other: 0 } },
      { name: 'Comfort', description: 'Prioritizes accommodation & dining', budgetAllocation: { flights: Math.floor(budget * 0.25), accommodation: Math.floor(budget * 0.45), transportation: Math.floor(budget * 0.05), food: Math.floor(budget * 0.15), activities: budget - Math.floor(budget * 0.25) - Math.floor(budget * 0.45) - Math.floor(budget * 0.05) - Math.floor(budget * 0.15), other: 0 } },
      { name: 'Balanced', description: 'Even spread across categories', budgetAllocation: { flights: Math.floor(budget * 0.3), accommodation: Math.floor(budget * 0.3), transportation: Math.floor(budget * 0.1), food: Math.floor(budget * 0.15), activities: budget - Math.floor(budget * 0.3) - Math.floor(budget * 0.3) - Math.floor(budget * 0.1) - Math.floor(budget * 0.15), other: 0 } },
      { name: 'Budget Traveler', description: 'Save on stay, spend on food/flights', budgetAllocation: { flights: Math.floor(budget * 0.4), accommodation: Math.floor(budget * 0.2), transportation: Math.floor(budget * 0.1), food: Math.floor(budget * 0.2), activities: budget - Math.floor(budget * 0.4) - Math.floor(budget * 0.2) - Math.floor(budget * 0.1) - Math.floor(budget * 0.2), other: 0 } }
    ];
  };

  const selectPlan = (planAlloc: BudgetAllocation) => {
    const dest = form.destination.trim();
    const code = dest.slice(0, 3).toUpperCase();
    const preset = budgetPresets.find(p => p.tier === form.budgetTier);
    createTrip({
      name: form.name.trim() || `${dest} trip`,
      destination: dest,
      destinationCode: code,
      origin: form.origin.trim() || 'SFO',
      originCode: (form.origin.trim() || 'SFO').slice(0, 3).toUpperCase(),
      startDate: form.startDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      endDate: form.endDate || new Date(Date.now() + 37 * 86400000).toISOString().slice(0, 10),
      travelers: form.travelers,
      budget: { tier: form.budgetTier, amount: preset?.amount ?? form.budgetAmount, currency: form.budgetCurrency },
      budgetAllocation: planAlloc,
      selectedFlight: null,
      selectedStay: null,
      savedActivities: [],
      selectedLivePlaces: [],
      itinerary: [],
    });
    setCreating(false);
    setPlans(null);
    setForm({ name: '', destination: '', origin: '', startDate: '', endDate: '', travelers: 2, budgetTier: 'Standard', budgetAmount: 3500, budgetCurrency: 'USD' });
    setLocation('/');
  };

  return <div className="page"><PageHeading eyebrow="Your library" title="My trips" description="Keep the plans worth returning to. TraveL& saves your choices locally." actions={<button className="btn btn-primary" onClick={() => {setCreating(true); setPlans(null);}} data-testid="button-new-trip"><Plus /> Start a new trip</button>} />
    {creating && !plans && <div className="card trip-create-form" style={{ marginBottom: 15 }}>
      <form onSubmit={handleCreate}>
        <div className="section-label" style={{ margin: '0 0 10px' }}><h2>New trip</h2><button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}><X /></button></div>
        <div className="trip-create-fields">
          <label>Destination<input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Paris, Rome, Istanbul..." required /></label>
          <label>Trip name (optional)<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Weekend in Paris..." /></label>
          <label>Origin<input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="SFO, CAI, LHR..." /></label>
          <label>Travelers<input type="number" min="1" max="12" value={form.travelers} onChange={e => setForm({ ...form, travelers: Number(e.target.value) || 1 })} /></label>
          <label>Departure<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>Return<input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></label>
          <label>Budget level<select value={form.budgetTier} onChange={e => { const tier = e.target.value as BudgetTier | 'Custom'; const p = budgetPresets.find(bp => bp.tier === tier); setForm({ ...form, budgetTier: tier, budgetAmount: p?.amount ?? form.budgetAmount }); }}><option value="Budget">Budget</option><option value="Economy">Economy</option><option value="Standard">Standard</option><option value="Premium">Premium</option><option value="Luxury">Luxury</option><option value="Custom">Custom</option></select></label>
          <label>Currency<select value={form.budgetCurrency} onChange={e => setForm({ ...form, budgetCurrency: e.target.value as BudgetCurrency })}>{currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn btn-primary" type="submit"><Plus /> Choose Plan</button><button className="btn btn-quiet" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
      </form>
    </div>}
    {creating && plans && <div className="card trip-create-form" style={{ marginBottom: 15 }}>
      <div className="section-label" style={{ margin: '0 0 10px' }}><h2>Select a Budget Plan</h2><button type="button" className="btn btn-ghost" onClick={() => setPlans(null)}>Back</button></div>
      <div className="grid grid-2">
        {plans.map((p, i) => (
          <div className="card option-card" key={i} style={{ padding: '16px' }}>
            <div className="option-top"><div><h3>{p.name}</h3><p>{p.description}</p></div></div>
            <div className="option-details" style={{ marginTop: '12px' }}>
              <div><span>Flights</span><strong>${p.budgetAllocation.flights}</strong></div>
              <div><span>Accommodation</span><strong>${p.budgetAllocation.accommodation}</strong></div>
              <div><span>Transport</span><strong>${p.budgetAllocation.transportation}</strong></div>
              <div><span>Food</span><strong>${p.budgetAllocation.food}</strong></div>
              <div><span>Activities</span><strong>${p.budgetAllocation.activities}</strong></div>
            </div>
            <div className="option-footer" style={{ marginTop: '16px' }}>
              <button className="btn btn-primary" onClick={() => selectPlan(p.budgetAllocation)}>Choose This Plan</button>
            </div>
          </div>
        ))}
      </div>
    </div>}
    <div className="grid grid-2">
      {store.trips.map((trip, index) => {
        const progress = tripProgress(trip);
        const isCurrent = trip.id === current.id;
        return <div className={`card option-card ${isCurrent ? 'selected' : ''}`} key={trip.id}>
          <div style={{ height: 145, background: tripGradients[index % tripGradients.length], position: 'relative' }}>
            <div className="eyebrow" style={{ position: 'absolute', bottom: 16, left: 17, color: 'hsl(40 38% 97% / .72)' }}>{isCurrent ? 'Current trip \u00b7 planning' : `Trip ${index + 1}`}</div>
            <div style={{ position: 'absolute', right: 18, top: 17, color: 'hsl(40 38% 97% / .76)', fontFamily: 'var(--app-font-serif)', fontSize: 35 }}>{trip.destinationCode || trip.destination.slice(0, 3).toUpperCase()}</div>
          </div>
          <div className="option-card-body">
            <div className="option-top"><div><h3>{trip.name}</h3><p>{formatDateRange(trip.startDate, trip.endDate)} \u00b7 {trip.travelers} traveler{trip.travelers > 1 ? 's' : ''}</p></div><span className="option-tag">{progress}% ready</span></div>
            <div className="option-footer" style={{ marginTop: 17 }}>
              <div className="trip-actions">
                <button onClick={() => duplicateTrip(trip.id)} title="Duplicate"><Copy /></button>
                {store.trips.length > 1 && <button onClick={() => { if (confirm(`Delete "${trip.name}"?`)) deleteTrip(trip.id); }} title="Delete"><Trash2 /></button>}
              </div>
              <button className={`btn ${isCurrent ? 'btn-accent' : 'btn-quiet'}`} onClick={() => { setCurrent(trip.id); setLocation('/'); }} data-testid={`button-open-${trip.id}`}>{isCurrent ? <>Open trip <ArrowRight /></> : 'Switch to trip'}</button>
            </div>
          </div>
        </div>;
      })}
      <div className="card empty-state"><div><Compass size={27} /><h3>A new horizon?</h3><p>Start with a place, a feeling, or a date. You can always change your mind.</p><button className="btn btn-quiet" onClick={() => setCreating(true)} data-testid="button-create-trip"><Plus /> Create trip</button></div></div>
    </div>
    {store.trips.some(t => tripProgress(t) >= 100) && <><div className="section-label"><h2>Completed trips</h2></div>{store.trips.filter(t => tripProgress(t) >= 100).map(t => <div className="card card-pad" key={t.id} style={{ marginBottom: 10 }}><div className="next-card"><div className="stat-icon"><Check /></div><div><h3>{t.name}</h3><p>{formatDateRange(t.startDate, t.endDate)}</p></div><button className="btn btn-quiet" onClick={() => { setCurrent(t.id); setLocation('/'); }}>View <ArrowRight /></button></div></div>)}</>}
    {store.trips.every(t => tripProgress(t) < 100) && <><div className="section-label"><h2>Past trips</h2></div><div className="card empty-state"><div><CalendarDays size={25} /><h3>Nothing archived yet.</h3><p>Completed trips will live here, ready to revisit or use as a starting point.</p></div></div></>}
  </div>;
}

function NotFound() { return <div className="page"><div className="card empty-state"><div><Compass size={28} /><h3>This path wandered off.</h3><p>Let's bring you back to the trip.</p><Link className="btn btn-primary" href="/">Return to trip brief</Link></div></div></div>; }

/* ─── Shell ───────────────────────────────────────────────────────────────── */

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [dark, setDark] = useStored('tripwise-theme', false);
  const [notice, setNotice] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { current } = useTripStore();
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3000); };
  const nights = calculateNights(current.startDate, current.endDate);
  const progress = tripProgress(current);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand"><TravelLogo /><span className="brand-name">TraveL&amp;</span></Link>
      <div className="nav-section eyebrow">Your workspace</div>
      <nav className="nav-list">{nav.map(item => { const Icon = item.icon; const active = location === item.href || (item.href !== '/' && location.startsWith(item.href)); return <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replace(' ', '-')}`}><Icon /><span>{item.label}</span>{item.label === 'Itinerary' && <span style={{ marginLeft: 'auto', fontSize: 10 }}>{calculateNights(current.startDate, current.endDate)}</span>}</Link>; })}</nav>
      <div className="nav-section eyebrow" style={{ marginTop: 28 }}>Library</div>
      <nav className="nav-list"><Link href="/trips" className={`nav-item ${location === '/trips' ? 'active' : ''}`} data-testid="link-nav-my-trips"><ListChecks /><span>My trips</span></Link><button className="nav-item" onClick={() => notify('Preferences are ready for your next trip')} data-testid="button-preferences"><Settings2 /><span>Preferences</span></button></nav>
      <div className="trip-mini"><div className="eyebrow">Current trip</div><div className="trip-mini-title">{current.destination}</div><div className="trip-mini-meta">{formatDateRange(current.startDate, current.endDate)} \u00b7 {current.travelers} traveler{current.travelers > 1 ? 's' : ''}</div><div className="mini-progress"><span style={{ width: `${progress}%` }} /></div><div className="trip-mini-meta" style={{ marginTop: 8 }}>Plan is {progress}% ready</div></div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="mobile-brand"><TravelLogo />TraveL&amp;</div><div className="eyebrow mobile-menu">{current.destination} \u00b7 {new Date(current.startDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div><div className="top-actions"><button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle theme" data-testid="button-toggle-theme">{dark ? <Sun /> : <Moon />}</button><button className="icon-btn" onClick={() => notify('Share link copied \u2014 demo links are private to this workspace')} aria-label="Share trip" data-testid="button-share-trip"><Share2 /></button><div className="avatar" title="Maya">M</div></div></header>
      {mobileOpen && <div style={{ position: 'fixed', zIndex: 25, inset: '64px 0 auto', background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))', padding: 15 }}>{nav.slice(0, 5).map(item => <Link key={item.href} href={item.href} className="nav-item" onClick={() => setMobileOpen(false)}>{item.label}</Link>)}</div>}
      <main>{children}</main>
    </div>
    <nav className="mobile-nav">{[nav[0], nav[4], nav[2], { href: '/trips', label: 'Trips', icon: ListChecks }].map(item => { const Icon = item.icon; const active = location === item.href; return <Link key={item.href} href={item.href} className={active ? 'active' : ''} data-testid={`link-mobile-${item.label.toLowerCase()}`}><Icon /><span>{item.label}</span></Link>; })}</nav>
    {notice && <div className="toast" role="status" data-testid="status-toast">{notice}</div>}
    <button onClick={() => setMobileOpen(!mobileOpen)} className="icon-btn" style={{ display: 'none' }} aria-label="Open navigation"><Menu /></button>
  </div>;
}

/* ─── Router & App ────────────────────────────────────────────────────────── */

function Router() {
  return <Shell><Switch><Route path="/" component={Home} /><Route path="/flights" component={Flights} /><Route path="/stays" component={Stays} /><Route path="/explore" component={Explore} /><Route path="/itinerary" component={Itinerary} /><Route path="/budget" component={Budget} /><Route path="/packing" component={Packing} /><Route path="/trips" component={Trips} /><Route component={NotFound} /></Switch></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter></QueryClientProvider>;
}

export default App;
