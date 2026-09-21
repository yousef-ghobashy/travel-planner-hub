import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  ArrowRight, Backpack, BarChart3, BedDouble, CalendarDays, Check, ChevronRight,
  CircleDollarSign, Clock3, CloudSun, Compass, ExternalLink, FileDown, Flame,
  Heart, Home as HomeIcon, Info, Landmark, ListChecks, MapPin, Menu, Moon,
  Plane, Plus, Search, Settings2, Share2, Sparkles, Sun, Ticket, TrainFront,
  Utensils, WalletCards, X,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  getGetTravelSearchLinksQueryKey,
  getGetTravelWeatherQueryKey,
  getGetTravelExchangeRateQueryKey,
  getSearchTravelAirportsQueryKey,
  getSearchTravelPlacesQueryKey,
  useGetTravelSearchLinks,
  useGetTravelWeather,
  useGetTravelExchangeRate,
  useSearchTravelAirports,
  useSearchTravelPlaces,
} from '@workspace/api-client-react';

const queryClient = new QueryClient();

type PickType = 'flight' | 'stay' | 'activity';
type Saved = { flight: string; stay: string; activities: string[] };
type BudgetTier = 'Budget' | 'Economy' | 'Standard' | 'Premium' | 'Luxury';
type BudgetCurrency = 'USD' | 'EGP' | 'EUR' | 'GBP';
type BudgetSettings = { tier: BudgetTier | 'Custom'; amount: number; currency: BudgetCurrency };
type BudgetStatus = 'Within Budget' | 'Near Budget' | 'Over Budget';

const defaultSaved: Saved = { flight: 'flight-2', stay: 'stay-1', activities: ['activity-1', 'activity-3'] };
const defaultBudget: BudgetSettings = { tier: 'Standard', amount: 3500, currency: 'USD' };
const budgetPresets: Array<{ tier: BudgetTier; amount: number; note: string }> = [
  { tier: 'Budget', amount: 1500, note: 'Essentials first' },
  { tier: 'Economy', amount: 2200, note: 'Simple and flexible' },
  { tier: 'Standard', amount: 3500, note: 'Balanced choices' },
  { tier: 'Premium', amount: 5000, note: 'More comfort' },
  { tier: 'Luxury', amount: 8000, note: 'Make it special' },
];
const currencies: BudgetCurrency[] = ['USD', 'EGP', 'EUR', 'GBP'];
const demoBreakdown = [
  { label: 'Flights', amount: 1636, icon: Plane, note: 'Roundtrip for 2 · demo estimate' },
  { label: 'Accommodation', amount: 1284, icon: BedDouble, note: 'Casa Lirio · 6 nights · demo estimate' },
  { label: 'Transportation', amount: 62, icon: TrainFront, note: 'Metro, airport transfer, walking · demo estimate' },
  { label: 'Food & coffee', amount: 382, icon: Utensils, note: 'A generous daily estimate · demo estimate' },
  { label: 'Activities', amount: 116, icon: Landmark, note: 'Entries & experiences · demo estimate' },
  { label: 'Other', amount: 0, icon: CircleDollarSign, note: 'Buffer not assigned' },
];

function formatMoney(amount: number, currency: BudgetCurrency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function budgetStatus(total: number, budget: number): BudgetStatus {
  if (total <= budget) return 'Within Budget';
  if (total <= budget * 1.15) return 'Near Budget';
  return 'Over Budget';
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

function AirportAutocomplete({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  const params = { q: value.trim(), limit: 6 };
  const airports = useSearchTravelAirports(params, { query: { enabled: params.q.length >= 2, staleTime: 3600000, queryKey: getSearchTravelAirportsQueryKey(params) } });
  return <label className="airport-autocomplete">{label}<input value={value} onFocus={() => setFocused(true)} onChange={event => onChange(event.target.value)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} placeholder="City, airport, or code" autoComplete="off" />
    {focused && value.trim().length >= 2 && airports.data?.airports.length ? <div className="airport-results">{airports.data.airports.map(airport => <button type="button" className="airport-result" key={airport.id} onMouseDown={() => onChange(airport.iataCode)}><strong>{airport.city}, {airport.country}</strong><span>{airport.airportName}</span><small>{airport.iataCode}</small></button>)}</div> : null}
  </label>;
}

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}

function TravelLogo() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6.5 17.5 12.8 6.4l4.7 8.1-8.8 1.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12.8" cy="6.4" r="2" fill="currentColor" /><circle cx="6.5" cy="17.5" r="1.5" fill="currentColor" /></svg></span>;
}

const flights = [
  { id: 'flight-1', airline: 'Air France', code: 'AF', out: '08:10', back: '19:35', duration: '10h 45m', stops: '1 stop', price: '$742', note: 'Best schedule' },
  { id: 'flight-2', airline: 'KLM', code: 'K', out: '14:25', back: '11:20', duration: '10h 10m', stops: 'Nonstop', price: '$818', note: 'Recommended' },
  { id: 'flight-3', airline: 'Iberia', code: 'IB', out: '22:40', back: '13:55', duration: '11h 30m', stops: '1 stop', price: '$681', note: 'Lowest estimate' },
];
const stays = [
  { id: 'stay-1', name: 'Casa Lirio', area: 'El Born · Barcelona', rating: '9.2', price: '$214', note: 'Quiet courtyard, walkable to the old town', features: ['Boutique', 'Breakfast included'] },
  { id: 'stay-2', name: 'The Hoxton, Poblenou', area: 'Poblenou · Barcelona', rating: '8.8', price: '$176', note: 'A creative base with a rooftop pool', features: ['Design-led', 'Free cancellation'] },
  { id: 'stay-3', name: 'Yurbban Ramblas', area: 'Eixample · Barcelona', rating: '9.0', price: '$198', note: 'Calm rooms, excellent location for first visits', features: ['Central', 'Terrace'] },
];
const activities = [
  { id: 'activity-1', name: 'Picasso Museum', category: 'Culture', area: 'El Born', length: '2 hours', price: '$18', note: 'A focused look at the artist’s formative years.', color: 'hsl(14 58% 62%)' },
  { id: 'activity-2', name: 'Montjuïc sunset walk', category: 'Outdoors', area: 'Montjuïc', length: '2.5 hours', price: 'Free', note: 'Golden-hour views, gardens, and a slower pace above the city.', color: 'hsl(101 28% 52%)' },
  { id: 'activity-3', name: 'Casa Batlló', category: 'Architecture', area: 'Passeig de Gràcia', length: '90 minutes', price: '$39', note: 'Gaudí’s dreamlike interiors with an early entry slot.', color: 'hsl(204 34% 61%)' },
  { id: 'activity-4', name: 'La Boqueria tasting walk', category: 'Food', area: 'La Rambla', length: '2 hours', price: '$52', note: 'Market bites with a local food writer.', color: 'hsl(39 71% 65%)' },
  { id: 'activity-5', name: 'Barceloneta morning swim', category: 'Outdoors', area: 'Barceloneta', length: '1 hour', price: 'Free', note: 'An unhurried start before the beach gets lively.', color: 'hsl(175 45% 25%)' },
  { id: 'activity-6', name: 'Palau de la Música', category: 'Culture', area: 'La Ribera', length: '75 minutes', price: '$22', note: 'A small, ornate jewel of Catalan modernism.', color: 'hsl(14 58% 62%)' },
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

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [dark, setDark] = useStored('tripwise-theme', false);
  const [notice, setNotice] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3000); };
  const exportItinerary = () => {
    const text = `TRAVEL / BARCELONA IN FULL\nApril 18–24, 2025 · 6 nights · 2 travelers\n\nDAY 01 — ARRIVE & EXHALE\n14:25  KLM arrival · Barcelona El Prat\n18:30  Barceloneta promenade · Unhurried first walk\n20:00  Dinner at Can Culleretes · Demo estimate $68\n\nDAY 02 — OLD CITY / EL BORN\n09:30  Picasso Museum · Demo estimate $18\n12:30  Lunch near Santa Maria del Mar\n16:00  Free afternoon in El Born\n\nDAY 03 — GAUDÍ & A SLOW AFTERNOON\n09:00  Casa Batlló · Demo estimate $39\n13:00  Lunch in Eixample\n17:30  Montjuïc sunset walk · Free\n\nESTIMATED TRIP TOTAL: $3,480 for 2 travelers\nAll prices and availability are demo estimates. TraveL does not book travel. Verify details with the provider before purchase.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'travel-barcelona-itinerary.txt'; link.click(); URL.revokeObjectURL(url);
    notify('Itinerary exported as a text file');
  };
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand"><TravelLogo /><span className="brand-name">TraveL</span></Link>
      <div className="nav-section eyebrow">Your workspace</div>
      <nav className="nav-list">{nav.map(item => { const Icon = item.icon; const active = location === item.href || (item.href !== '/' && location.startsWith(item.href)); return <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replace(' ', '-')}`}><Icon /><span>{item.label}</span>{item.label === 'Itinerary' && <span style={{ marginLeft: 'auto', fontSize: 10 }}>3</span>}</Link>; })}</nav>
      <div className="nav-section eyebrow" style={{ marginTop: 28 }}>Library</div>
      <nav className="nav-list"><Link href="/trips" className={`nav-item ${location === '/trips' ? 'active' : ''}`} data-testid="link-nav-my-trips"><ListChecks /><span>My trips</span></Link><button className="nav-item" onClick={() => notify('Preferences are ready for your next trip')} data-testid="button-preferences"><Settings2 /><span>Preferences</span></button></nav>
      <div className="trip-mini"><div className="eyebrow">Current trip</div><div className="trip-mini-title">Barcelona</div><div className="trip-mini-meta">Apr 18 — Apr 24 · 2 travelers</div><div className="mini-progress"><span /></div><div className="trip-mini-meta" style={{ marginTop: 8 }}>Plan is 62% ready</div></div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="mobile-brand"><TravelLogo />TraveL</div><div className="eyebrow mobile-menu">Barcelona · Spring 2025</div><div className="top-actions"><button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle theme" data-testid="button-toggle-theme">{dark ? <Sun /> : <Moon />}</button><button className="icon-btn" onClick={() => notify('Share link copied — demo links are private to this workspace')} aria-label="Share trip" data-testid="button-share-trip"><Share2 /></button><div className="avatar" title="Maya">M</div></div></header>
      {mobileOpen && <div style={{ position: 'fixed', zIndex: 25, inset: '64px 0 auto', background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))', padding: 15 }}>{nav.slice(0, 5).map(item => <Link key={item.href} href={item.href} className="nav-item" onClick={() => setMobileOpen(false)}>{item.label}</Link>)}</div>}
      <main>{children}</main>
    </div>
    <nav className="mobile-nav">{[nav[0], nav[4], nav[2], { href: '/trips', label: 'Trips', icon: ListChecks }].map(item => { const Icon = item.icon; const active = location === item.href; return <Link key={item.href} href={item.href} className={active ? 'active' : ''} data-testid={`link-mobile-${item.label.toLowerCase()}`}><Icon /><span>{item.label}</span></Link>; })}</nav>
    {notice && <div className="toast" role="status" data-testid="status-toast">{notice}</div>}
    <button onClick={() => setMobileOpen(!mobileOpen)} className="icon-btn" style={{ display: 'none' }} aria-label="Open navigation"><Menu /></button>
    <div style={{ display: 'none' }}><button onClick={exportItinerary}>export</button></div>
  </div>;
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-heading-actions">{actions}</div>}</div>;
}

function Home() {
  const [, setLocation] = useLocation();
  const [budget, setBudget] = useStored<BudgetSettings>('tripwise-budget', defaultBudget);
  return <div className="page">
    <PageHeading eyebrow="Good morning, Maya" title="A little room to wander." description="Your Barcelona plan is taking shape. We’ve kept the essentials close and left space for the parts you can’t schedule." actions={<><button className="btn btn-quiet" onClick={() => setLocation('/trips')} data-testid="button-view-trips">View my trips <ArrowRight /></button><button className="btn btn-primary" onClick={() => setLocation('/itinerary')} data-testid="button-open-itinerary">Open itinerary <CalendarDays /></button></>} />
    <div className="card planner-card"><div><div className="eyebrow">Planning preference</div><h2>Set the shape of this trip</h2><p>Recommendations will use this budget as you adjust it.</p></div><BudgetControls budget={budget} setBudget={setBudget} /><Link href="/budget" className="text-link">See the full breakdown <ArrowRight size={13} /></Link></div>
    <div className="brief-layout"><div className="hero-brief"><div className="hero-content"><div className="eyebrow">Trip brief · 06 days · Spring</div><h1>Barcelona<br /><em>in full.</em></h1><p>Gaudí mornings, late lunches, and a few beautiful wrong turns. Your trip, gathered in one calm place.</p><div className="hero-pills"><span className="hero-pill">18 — 24 Apr 2025</span><span className="hero-pill">2 travelers</span><span className="hero-pill">Slow & curious</span></div></div></div><div className="brief-side"><div className="card stat-card"><div className="stat-icon"><CircleDollarSign /></div><div><div className="stat-value">$3,480</div><div className="stat-note">estimated total · for 2 travelers</div></div></div><div className="card stat-card"><div className="stat-icon"><CloudSun /></div><div><div className="stat-value">20°</div><div className="stat-note">typical daytime high · Barcelona</div></div></div><div className="card next-card card-pad"><div className="next-date"><strong>18</strong><span>Apr</span></div><div><h3>Next up: fly to Barcelona</h3><p>KLM · SFO → BCN · nonstop · 10h 10m</p></div><ChevronRight size={17} className="muted" /></div></div></div>
    <div className="section-label"><h2>Plan at a glance</h2><Link href="/itinerary">See full plan <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></Link></div>
    <div className="grid grid-3"><Link href="/flights" className="card route-card" data-testid="card-glance-flights"><div className="route-city"><span>Departure</span><strong>SFO</strong><span>Apr 18 · KLM 682</span></div><div className="route-line" /><div className="route-city" style={{ textAlign: 'right' }}><span>Arrival</span><strong>BCN</strong><span>Apr 19 · 14:25</span></div></Link><Link href="/stays" className="card next-card card-pad" data-testid="card-glance-stay"><div className="stat-icon"><BedDouble /></div><div><h3>Casa Lirio</h3><p>El Born · 6 nights · selected stay</p></div><ChevronRight size={17} className="muted" /></Link><Link href="/explore" className="card next-card card-pad" data-testid="card-glance-picks"><div className="stat-icon"><Sparkles /></div><div><h3>3 things you saved</h3><p>Picasso Museum, Casa Batlló & more</p></div><ChevronRight size={17} className="muted" /></Link></div>
    <div className="section-label"><h2>Before you go</h2><span className="eyebrow">2 of 5 complete</span></div><div className="card card-pad"><div className="grid grid-3"><div className="next-card"><div className="stat-icon"><Check /></div><div><h3>Choose a flight</h3><p className="muted">KLM is currently your best match.</p></div></div><div className="next-card"><div className="stat-icon"><Plane /></div><div><h3>Check entry details</h3><p className="muted">US passport · no visa for Spain.</p></div></div><div className="next-card"><div className="stat-icon"><Backpack /></div><div><h3>Start packing</h3><p className="muted">Mild days, cool evenings.</p></div></div></div></div>
  </div>;
}

function Flights() {
  const [saved, setSaved] = useStored<Saved>('tripwise-selections', defaultSaved);
  const [budget, setBudget] = useStored<BudgetSettings>('tripwise-budget', defaultBudget);
  const [search, setSearch] = useState({ origin: 'SFO', destination: 'Barcelona', departureDate: '2027-04-18', returnDate: '2027-04-24', travelers: 2 });
  const [submitted, setSubmitted] = useState(search);
  const links = useGetTravelSearchLinks(submitted, { query: { staleTime: 300000, queryKey: getGetTravelSearchLinksQueryKey(submitted) } });
  const weatherParams = { city: submitted.destination, startDate: submitted.departureDate, endDate: submitted.returnDate };
  const weather = useGetTravelWeather(weatherParams, { query: { staleTime: 300000, queryKey: getGetTravelWeatherQueryKey(weatherParams) } });
  const exchange = useGetTravelExchangeRate({ from: 'USD', to: budget.currency }, { query: { staleTime: 3600000, queryKey: getGetTravelExchangeRateQueryKey({ from: 'USD', to: budget.currency }) } });
  const estimateInBudgetCurrency = (amount: number) => amount * (budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 0);
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted({ ...search });
  };
  return <div className="page"><PageHeading eyebrow="Getting there" title="Find your way in." description="Search your route with live provider links, then keep the planning decisions here." actions={<button className="btn btn-quiet" onClick={() => links.data?.flightSearchUrl && window.open(links.data.flightSearchUrl, '_blank')} data-testid="link-external-flight-search"><ExternalLink /> Compare live fares</button>} />
    <form className="card live-search" onSubmit={submitSearch}>
      <div className="live-search-heading"><div><div className="eyebrow">Live search handoff</div><h3>Search your real route</h3></div><span className="live-chip">No API key required</span></div>
      <div className="search-fields">
        <AirportAutocomplete label="From" value={search.origin} onChange={origin => setSearch({ ...search, origin })} />
        <AirportAutocomplete label="To" value={search.destination} onChange={destination => setSearch({ ...search, destination })} />
        <label>Depart<input type="date" value={search.departureDate} onChange={event => setSearch({ ...search, departureDate: event.target.value })} /></label>
        <label>Return<input type="date" value={search.returnDate} onChange={event => setSearch({ ...search, returnDate: event.target.value })} /></label>
        <label>Travelers<input type="number" min="1" max="12" value={search.travelers} onChange={event => setSearch({ ...search, travelers: Number(event.target.value) || 1 })} /></label>
        <button className="btn btn-primary" type="submit"><Search /> Search</button>
      </div>
      <BudgetControls budget={budget} setBudget={setBudget} />
      {links.data && <div className="provider-links"><a className="external" href={links.data.flightSearchUrl} target="_blank" rel="noreferrer">Open live flights <ExternalLink size={12} /></a><a className="external" href={links.data.accommodationSearchUrl} target="_blank" rel="noreferrer">Open live stays <ExternalLink size={12} /></a></div>}
    </form>
    <div className="notice"><Info /><span>TraveL uses live provider searches for current fares. This app does not invent prices, take payment, or confirm bookings.</span></div>
    {weather.data && <div className="card live-weather"><div><div className="eyebrow">Destination outlook · {weather.data.city}</div><strong>{weather.data.days[0] ? `${Math.round(weather.data.days[0].minC)}–${Math.round(weather.data.days[0].maxC)}°C` : 'Forecast not available yet'}</strong><span>{weather.data.note ?? `from Open-Meteo · refreshed ${new Date(weather.data.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span></div>{weather.data.days.length > 0 && <div className="weather-days">{weather.data.days.slice(0, 4).map(day => <span key={day.date}><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</b>{Math.round(day.maxC)}° · {day.precipitationProbability}% rain</span>)}</div>}</div>}
    <div className="card" style={{ marginTop: 15 }}><div className="route-card"><div className="route-city"><span>From</span><strong>{submitted.origin.toUpperCase().slice(0, 3)}</strong><span>{submitted.origin}</span></div><div className="route-line" /><div className="route-city" style={{ textAlign: 'right' }}><span>To</span><strong>{submitted.destination.toUpperCase().slice(0, 3)}</strong><span>{submitted.destination}</span></div></div>{flights.map(flight => { const converted = estimateInBudgetCurrency(Number(flight.price.replace(/[^0-9]/g, ''))); const status = converted > 0 ? budgetStatus(converted, budget.amount * .47) : null; return <div className={`flight-row ${saved.flight === flight.id ? 'selected' : ''}`} key={flight.id}><div className="flight-main"><div className="airline-mark">{flight.code}</div><div><div className="flight-times"><strong>{flight.out}</strong><span className="dash" /><strong>{flight.back}</strong></div><div className="flight-meta">{flight.airline} · {flight.duration} · {flight.stops}</div></div></div><div className="flight-price"><strong>{flight.price}</strong><span>demo only</span></div><span className="option-tag">{status ?? flight.note}</span><button className={`btn ${saved.flight === flight.id ? 'btn-accent' : 'btn-quiet'}`} onClick={() => setSaved({ ...saved, flight: flight.id })} data-testid={`button-select-${flight.id}`}>{saved.flight === flight.id ? <><Check /> Selected</> : 'Select'}</button></div>; })}</div>
    <div className="section-label"><h2>Good to know</h2></div><div className="grid grid-3"><div className="card card-pad"><div className="eyebrow">Timing</div><h3 style={{ margin: '9px 0 5px' }}>Arrive with daylight</h3><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>The KLM option gives you an easy first afternoon to check in and walk the waterfront.</p></div><div className="card card-pad"><div className="eyebrow">Handoff</div><h3 style={{ margin: '9px 0 5px' }}>Book direct when ready</h3><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>TraveL will hand you off to the airline. It never handles payment or booking.</p></div><div className="card card-pad"><div className="eyebrow">Flexibility</div><h3 style={{ margin: '9px 0 5px' }}>Hold a backup</h3><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>The Air France schedule is a useful alternative if arrival time matters more than fare.</p></div></div>
  </div>;
}

function Stays() {
  const [saved, setSaved] = useStored<Saved>('tripwise-selections', defaultSaved);
  const [budget] = useStored<BudgetSettings>('tripwise-budget', defaultBudget);
  const exchange = useGetTravelExchangeRate({ from: 'USD', to: budget.currency }, { query: { staleTime: 3600000, queryKey: getGetTravelExchangeRateQueryKey({ from: 'USD', to: budget.currency }) } });
  const rate = budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 0;
  const [city, setCity] = useState('Barcelona');
  const [submittedCity, setSubmittedCity] = useState('Barcelona');
  const placesParams = { city: submittedCity, kind: 'lodging', limit: 12 };
  const places = useSearchTravelPlaces(placesParams, { query: { staleTime: 300000, queryKey: getSearchTravelPlacesQueryKey(placesParams) } });
  const [submitted, setSubmitted] = useState({ origin: 'SFO', destination: 'Barcelona', departureDate: '2027-04-18', returnDate: '2027-04-24', travelers: 2 });
  const links = useGetTravelSearchLinks(submitted, { query: { staleTime: 300000, queryKey: getGetTravelSearchLinksQueryKey(submitted) } });
  const submitCity = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedCity(city.trim() || 'Barcelona');
    setSubmitted({ ...submitted, destination: city.trim() || 'Barcelona' });
  };
  return <div className="page"><PageHeading eyebrow="A place to land" title="Stay somewhere with a pulse." description="Find real hotels, motels, hostels, and guest houses from OpenStreetMap, then verify price and availability with a provider." actions={<button className="btn btn-primary" onClick={() => links.data?.accommodationSearchUrl && window.open(links.data.accommodationSearchUrl, '_blank')} data-testid="link-external-stay-search">Search live availability <ExternalLink /></button>} />
    <form className="card live-search" onSubmit={submitCity}>
      <div className="live-search-heading"><div><div className="eyebrow">Free place discovery</div><h3>Find lodging in any city</h3></div><span className="live-chip">OpenStreetMap</span></div>
      <div className="search-fields lodging-fields"><label>Destination city<input value={city} onChange={event => setCity(event.target.value)} placeholder="Barcelona, Cairo, Rome..." /></label><button className="btn btn-primary" type="submit"><Search /> Find places</button></div>
      {links.data && <div className="provider-links"><a className="external" href={links.data.accommodationSearchUrl} target="_blank" rel="noreferrer">Check live rooms and prices <ExternalLink size={12} /></a></div>}
    </form>
    <div className="notice"><Info /><span>Place names and map links are live from OpenStreetMap. This free source does not provide room prices, ratings, or availability, so those fields stay blank instead of being fabricated.</span></div>
    {places.isLoading && <div className="card card-pad loading-card">Finding lodging around {submittedCity}…</div>}
    {places.data && <><div className="section-label"><h2>Live places around {places.data.city}</h2><span className="eyebrow">Retrieved {new Date(places.data.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="option-grid grid" style={{ marginTop: 15 }}>{places.data.places.map(place => <div className="card option-card live-place-card" key={place.id}><div className="option-card-body"><div className="option-top"><div><h3>{place.name}</h3><p>{place.category} · {place.address ?? 'Address not listed'}</p></div><span className="option-tag">Live place</span></div><div className="option-details"><div><span>Price</span><strong>Not provided</strong></div><div><span>Availability</span><strong>Verify direct</strong></div></div><div className="option-footer"><a className="external" href={place.mapLink} target="_blank" rel="noreferrer">Map <ExternalLink size={11} /></a>{place.website ? <a className="external" href={place.website} target="_blank" rel="noreferrer">Website <ExternalLink size={11} /></a> : <span className="muted">No website listed</span>}</div></div></div>)}</div></>}
    {places.isError && <div className="notice"><Info /><span>OpenStreetMap is unavailable right now. You can still search current rooms and prices through the provider link above.</span></div>}
    <div className="section-label"><h2>Planning examples</h2><span className="eyebrow">Demo only</span></div><div className="option-grid grid" style={{ marginTop: 15 }}>{stays.map(stay => { const nightly = Number(stay.price.replace(/[^0-9]/g, '')); const total = nightly * 6 * rate; const status = total > 0 ? budgetStatus(total, budget.amount * .37) : null; return <div className={`card option-card ${saved.stay === stay.id ? 'selected' : ''}`} key={stay.id}><div className="option-card-body"><div className="option-top"><div><h3>{stay.name}</h3><p>{stay.area}</p></div><span className="option-tag">{status ?? (saved.stay === stay.id ? 'Your choice' : 'Demo pick')}</span></div><div style={{ marginTop: 16, height: 84, borderRadius: 9, background: `linear-gradient(135deg, hsl(var(--primary) / .9), ${stay.id === 'stay-1' ? 'hsl(14 58% 62% / .8)' : stay.id === 'stay-2' ? 'hsl(204 34% 61% / .8)' : 'hsl(39 71% 65% / .75)'})`, position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', inset: '32px 0 0', background: 'hsl(var(--card) / .18)', clipPath: 'polygon(0 40%, 27% 0, 55% 45%, 74% 14%, 100% 55%, 100% 100%, 0 100%)' }} /><span style={{ position: 'absolute', right: 10, top: 10, color: 'hsl(40 38% 97% / .8)', fontSize: 10 }}>{stay.rating} / 10</span></div><p style={{ marginTop: 14 }}>{stay.note}</p><div className="option-details"><div><span>From</span><strong>{stay.price}<small className="muted"> / night</small></strong></div><div><span>Includes</span><strong>{stay.features[0]}</strong></div></div><div className="option-footer"><a className="external" href="https://www.booking.com" target="_blank" rel="noreferrer" data-testid={`link-provider-${stay.id}`}>Provider handoff <ExternalLink size={11} /></a><button className={`btn ${saved.stay === stay.id ? 'btn-accent' : 'btn-quiet'}`} onClick={() => setSaved({ ...saved, stay: stay.id })} data-testid={`button-select-${stay.id}`}>{saved.stay === stay.id ? <><Check /> Selected</> : 'Choose stay'}</button></div></div></div>; })}</div>
  </div>;
}

function Explore() {
  const [saved, setSaved] = useStored<Saved>('tripwise-selections', defaultSaved);
  const [budget] = useStored<BudgetSettings>('tripwise-budget', defaultBudget);
  const exchange = useGetTravelExchangeRate({ from: 'USD', to: budget.currency }, { query: { staleTime: 3600000, queryKey: getGetTravelExchangeRateQueryKey({ from: 'USD', to: budget.currency }) } });
  const rate = budget.currency === 'USD' ? 1 : exchange.data?.rate ?? 0;
  const [filter, setFilter] = useState('All');
  const visible = filter === 'All' ? activities : activities.filter(a => a.category === filter);
  const categories = ['All', 'Culture', 'Outdoors', 'Architecture', 'Food'];
  return <div className="page"><PageHeading eyebrow="Make room for wonder" title="A city worth getting lost in." description="Save what catches your eye. We’ll keep it close to the right day without turning your trip into a checklist." actions={<Link href="/itinerary" className="btn btn-primary" data-testid="button-explore-itinerary">View your picks <ArrowRight /></Link>} />
    <div className="filters">{categories.map(item => <button key={item} className={`filter-pill ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)} data-testid={`button-filter-${item.toLowerCase()}`}>{item}</button>)}</div>
    <div className="option-grid grid">{visible.map(activity => { const isSaved = saved.activities.includes(activity.id); const amount = Number(activity.price.replace(/[^0-9]/g, '')) || 0; const status = amount && rate ? budgetStatus(amount * rate, budget.amount * .08) : null; return <div className={`card option-card ${isSaved ? 'selected' : ''}`} key={activity.id}><div style={{ height: 102, background: `linear-gradient(140deg, ${activity.color}, hsl(var(--primary) / .86))`, position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', width: 150, height: 150, border: '1px solid hsl(40 38% 97% / .28)', borderRadius: '50%', right: -20, top: -55 }} /><div style={{ position: 'absolute', left: 17, bottom: 12, color: 'hsl(40 38% 97% / .84)', fontFamily: 'var(--app-font-mono)', fontSize: 10 }}>{activity.category} / BCN</div></div><div className="option-card-body"><div className="option-top"><div><h3>{activity.name}</h3><p>{activity.area} · {activity.length}</p></div><button className="tiny-btn" aria-label={isSaved ? 'Remove saved activity' : 'Save activity'} onClick={() => setSaved({ ...saved, activities: isSaved ? saved.activities.filter(id => id !== activity.id) : [...saved.activities, activity.id] })} data-testid={`button-save-${activity.id}`}>{isSaved ? <Heart fill="currentColor" /> : <Heart />}</button></div><p style={{ marginTop: 13 }}>{activity.note}</p><div className="option-footer" style={{ marginTop: 15 }}><span className="mono" style={{ fontSize: 10 }}>{activity.price} <span className="muted">demo estimate</span></span><span className="option-tag">{status ?? (isSaved ? <><Check size={10} style={{ verticalAlign: 'middle' }} /> Saved</> : 'Demo pick')}</span></div></div></div>; })}</div>
    <div className="section-label"><h2>One local note</h2></div><div className="card card-pad"><div className="notice" style={{ background: 'transparent', padding: 0 }}><Sparkles /><span>Barcelona rewards a little restraint. Keep one afternoon open for a neighborhood you didn’t plan to visit — Gràcia is a lovely place to start.</span></div></div>
  </div>;
}

function MapPanel() {
  return <div className="map-panel"><div className="map-water" /><div className="map-route" /><div className="map-marker" style={{ left: '28%', top: '42%' }} /><div className="map-label" style={{ left: '23%', top: '32%' }}>Casa Lirio</div><div className="map-marker" style={{ left: '57%', top: '56%', background: 'hsl(204 34% 61%)' }} /><div className="map-label" style={{ left: '54%', top: '68%' }}>Casa Batlló</div><div className="map-marker" style={{ left: '72%', top: '25%', background: 'hsl(101 28% 52%)' }} /><div className="map-label" style={{ left: '67%', top: '17%' }}>Montjuïc</div><div className="map-legend"><span><i className="legend-dot" /> Your plan</span><span><i className="legend-dot" style={{ background: 'hsl(204 34% 61%)' }} /> Saved pick</span><span className="mono" style={{ marginLeft: 'auto', opacity: .65 }}>route context · demo</span></div></div>;
}

function Itinerary() {
  const [saved] = useStored<Saved>('tripwise-selections', defaultSaved);
  const [day, setDay] = useState(1);
  const days = [{ n: 1, date: 'Sat, Apr 19', title: 'Arrive & exhale', items: [['14:25', 'Land at Barcelona El Prat', 'Arrival · KLM 682'], ['18:30', 'Barceloneta promenade', 'A first walk by the water · Free'], ['20:00', 'Dinner at Can Culleretes', 'Catalan comfort · $68 demo estimate']] }, { n: 2, date: 'Sun, Apr 20', title: 'Old city, slow pace', items: [['09:30', 'Picasso Museum', 'El Born · $18 demo estimate'], ['12:30', 'Lunch around Santa Maria del Mar', 'Leave room for a good table'], ['16:00', 'A free afternoon in El Born', 'No reservation required · the best kind']] }, { n: 3, date: 'Mon, Apr 21', title: 'Gaudí & a high view', items: [['09:00', 'Casa Batlló', 'Passeig de Gràcia · $39 demo estimate'], ['13:00', 'Lunch in Eixample', 'A long table, no rush'], ['17:30', 'Montjuïc sunset walk', 'Gardens and city views · Free']] }];
  return <div className="page"><PageHeading eyebrow="The shape of your days" title="A plan with breathing room." description="Three anchors, plenty of space. Your saved places will find their way here as the plan settles." actions={<button className="btn btn-accent" onClick={() => { const a = document.createElement('a'); const blob = new Blob(['TraveL · Barcelona in full\\n\\nYour itinerary is ready to print.'], { type: 'text/html' }); a.href = URL.createObjectURL(blob); a.download = 'travel-itinerary.html'; a.click(); }} data-testid="button-export-itinerary"><FileDown /> Export itinerary</button>} />
    <div className="notice"><Info /><span>Route distances and costs are planning estimates. Venue links are provider handoffs — TraveL does not book or confirm anything.</span></div>
    <div style={{ display: 'flex', gap: 7, overflow: 'auto', margin: '17px 0 14px' }}>{days.map(d => <button key={d.n} className={`filter-pill ${day === d.n ? 'active' : ''}`} onClick={() => setDay(d.n)} data-testid={`button-day-${d.n}`}>Day {d.n} · {d.date.slice(0, 3)}</button>)}</div>
    <div className="itinerary-layout"><div className="grid">{days.filter(d => d.n === day).map(d => <div className="card timeline-day" key={d.n}><div className="day-head"><div className="day-number"><div className="day-index">0{d.n}</div><div><h3>{d.title}</h3><p>{d.date} · Barcelona</p></div></div><CloudSun size={19} className="muted" /></div><div className="timeline">{d.items.map((item, index) => <div className={`timeline-item ${index === 1 && d.n === 1 ? 'transit' : ''}`} key={item[0]}><div className="timeline-dot" /><div className="time">{item[0]}</div><div className="timeline-copy"><h4>{item[1]}</h4><p>{item[2]}</p>{index === 0 && d.n === 2 && <a className="external" style={{ marginTop: 6 }} href="https://www.museupicassobcn.cat/en" target="_blank" rel="noreferrer" data-testid="link-picasso-venue">Official venue site <ExternalLink size={10} /></a>}</div></div>)}</div></div>)}<div className="card card-pad"><div className="eyebrow">Saved for later</div><h3 style={{ fontFamily: 'var(--app-font-serif)', fontWeight: 500, margin: '8px 0 13px' }}>{saved.activities.length} saved experiences</h3><p className="muted" style={{ fontSize: 11, lineHeight: 1.45 }}>You can keep these loose, or add one to a day when the weather feels right.</p><Link href="/explore" className="btn btn-quiet" style={{ marginTop: 13 }} data-testid="button-manage-picks">Manage picks <ArrowRight /></Link></div></div><MapPanel /></div>
  </div>;
}

function Budget() {
  const [budget, setBudget] = useStored<BudgetSettings>('tripwise-budget', defaultBudget);
  const rateQuery = { from: 'USD', to: budget.currency };
  const exchange = useGetTravelExchangeRate(rateQuery, { query: { staleTime: 3600000, queryKey: getGetTravelExchangeRateQueryKey(rateQuery) } });
  const rate = budget.currency === 'USD' ? 1 : exchange.data?.rate;
  const totalUsd = demoBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const total = rate ? totalUsd * rate : totalUsd;
  const status = rate ? budgetStatus(total, budget.amount) : null;
  const displayEstimate = (amount: number) => rate ? formatMoney(amount * rate, budget.currency) : `${formatMoney(amount, 'USD')} USD`;
  const progress = rate ? Math.min(100, (total / Math.max(1, budget.amount)) * 100) : 0;
  return <div className="page"><PageHeading eyebrow="Keep the shape, not the stress" title="A budget that leaves room." description="Set a ceiling, see the demo estimate against it, and keep every recommendation tied to the same number." actions={<button className="btn btn-quiet" onClick={() => { navigator.clipboard?.writeText(`${formatMoney(total, budget.currency)} estimated total · Barcelona`); }} data-testid="button-copy-budget"><Share2 /> Copy summary</button>} />
    <div className="card card-pad budget-editor"><div className="section-label"><h2>Your trip budget</h2><span className="eyebrow">Updates everywhere</span></div><BudgetControls budget={budget} setBudget={setBudget} /></div>
    <div className="budget-layout"><div className="budget-hero"><div className="eyebrow budget-hero-label">Estimated trip total</div><div className="budget-total">{displayEstimate(totalUsd)}</div><div className="budget-note">for 2 travelers · 6 nights · {budget.currency}{!rate && budget.currency !== 'USD' ? ' · conversion pending' : ''}</div><div style={{ marginTop: 15 }}><div className="budget-progress-copy"><span>{status ?? 'Waiting for exchange rate'}</span><span>{formatMoney(budget.amount, budget.currency)} budget</span></div><div className="budget-track" style={{ marginTop: 8 }}><span style={{ width: `${progress}%` }} /></div></div><div className="notice budget-hero-note"><Info /><span>Prices are demo estimates, not live offers. Verify current fares, cancellation terms, availability, and exchange rates with each provider.</span></div></div><div className="card card-pad">{demoBreakdown.map(row => { const Icon = row.icon; const pct = rate ? Math.min(100, (row.amount * rate / Math.max(1, budget.amount)) * 100) : 0; return <div className="budget-row" key={row.label}><div className="budget-icon"><Icon /></div><div className="budget-row-main"><strong>{row.label}</strong><span>{row.note}</span><div className="bar-track"><span style={{ width: `${pct}%` }} /></div></div><div className="budget-amount">{displayEstimate(row.amount)}</div></div>; })}</div></div>
    <div className="section-label"><h2>Daily rhythm</h2><span className="eyebrow">demo estimate</span></div><div className="grid grid-3">{[210, 104, 178].map((amount, i) => <div className="card card-pad" key={amount}><div className="eyebrow">Day {i + 1}</div><div className="serif" style={{ fontSize: 25, marginTop: 8 }}>{displayEstimate(amount)}</div><div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{['Arrival', 'Old city', 'Gaudí day'][i]}</div></div>)}</div>
  </div>;
}

function Packing() {
  const [checked, setChecked] = useStored<string[]>('tripwise-packing', []);
  const groups = [{ name: 'Documents & essentials', items: ['Passport + a photo of it', 'Travel insurance details', 'eSIM / roaming plan', 'A small crossbody bag'] }, { name: 'Clothing', items: ['Light jacket for evenings', 'Comfortable walking shoes', 'One smart-casual dinner look', 'Swimwear'] }, { name: 'The small comforts', items: ['Refillable water bottle', 'SPF 30+ and sunglasses', 'Foldable tote for market mornings', 'Universal adapter'] }, { name: 'Activity-ready', items: ['Compact daypack', 'Headphones for the flight', 'Packable rain layer', 'A little room for ceramics'] }];
  const toggle = (item: string) => setChecked(checked.includes(item) ? checked.filter(x => x !== item) : [...checked, item]);
  return <div className="page"><PageHeading eyebrow="Pack with intention" title="Less luggage. More room." description="A gentle starting list for six spring days in Barcelona. Check things off and your list will be here when you return." actions={<button className="btn btn-quiet" onClick={() => setChecked([])} data-testid="button-reset-packing">Reset list</button>} />
    <div className="notice"><Backpack /><span>{checked.length} of {groups.reduce((sum, group) => sum + group.items.length, 0)} packed. Keep a little space — Barcelona has a way of sending people home with something beautiful.</span></div>
    <div className="pack-grid grid" style={{ marginTop: 15 }}>{groups.map(group => <div className="card pack-category" key={group.name}><h3>{group.name}</h3>{group.items.map(item => <div className="check-row" key={item}><input type="checkbox" checked={checked.includes(item)} onChange={() => toggle(item)} id={item} data-testid={`checkbox-${item.toLowerCase().replaceAll(' ', '-')}`} /><label htmlFor={item}>{item}</label></div>)}</div>)}</div>
  </div>;
}

function Trips() {
  const [, setLocation] = useLocation();
  return <div className="page"><PageHeading eyebrow="Your library" title="My trips" description="Keep the plans worth returning to. TraveL saves your choices locally in this demo workspace." actions={<button className="btn btn-primary" onClick={() => setLocation('/')} data-testid="button-new-trip"><Plus /> Start a new trip</button>} />
    <div className="grid grid-2"><div className="card option-card selected"><div style={{ height: 145, background: 'linear-gradient(145deg, hsl(var(--primary)), hsl(14 58% 62%))', position: 'relative' }}><div className="eyebrow" style={{ position: 'absolute', bottom: 16, left: 17, color: 'hsl(40 38% 97% / .72)' }}>Current trip · planning</div><div style={{ position: 'absolute', right: 18, top: 17, color: 'hsl(40 38% 97% / .76)', fontFamily: 'var(--app-font-serif)', fontSize: 35 }}>BCN</div></div><div className="option-card-body"><div className="option-top"><div><h3>Barcelona in full.</h3><p>Apr 18 — Apr 24, 2025 · 2 travelers</p></div><span className="option-tag">62% ready</span></div><div className="option-footer" style={{ marginTop: 17 }}><span className="muted" style={{ fontSize: 10 }}>Last edited just now</span><button className="btn btn-accent" onClick={() => setLocation('/')} data-testid="button-open-barcelona">Open trip <ArrowRight /></button></div></div></div><div className="card empty-state"><div><Compass size={27} /><h3>A new horizon?</h3><p>Start with a place, a feeling, or a date. You can always change your mind.</p><button className="btn btn-quiet" onClick={() => setLocation('/')} data-testid="button-create-trip"><Plus /> Create trip</button></div></div></div>
    <div className="section-label"><h2>Past trips</h2></div><div className="card empty-state"><div><CalendarDays size={25} /><h3>Nothing archived yet.</h3><p>Completed trips will live here, ready to revisit or use as a starting point.</p></div></div>
  </div>;
}

function NotFound() { return <div className="page"><div className="card empty-state"><div><Compass size={28} /><h3>This path wandered off.</h3><p>Let’s bring you back to the trip.</p><Link className="btn btn-primary" href="/">Return to trip brief</Link></div></div></div>; }

function Router() {
  return <Shell><Switch><Route path="/" component={Home} /><Route path="/flights" component={Flights} /><Route path="/stays" component={Stays} /><Route path="/explore" component={Explore} /><Route path="/itinerary" component={Itinerary} /><Route path="/budget" component={Budget} /><Route path="/packing" component={Packing} /><Route path="/trips" component={Trips} /><Route component={NotFound} /></Switch></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter></QueryClientProvider>;
}

export default App;
