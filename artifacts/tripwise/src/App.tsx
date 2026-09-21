import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  ArrowRight, ArrowLeft, Backpack, CalendarDays, Check, ChevronRight,
  CircleDollarSign, CloudSun, Compass, ExternalLink,
  Heart, Home as HomeIcon, Info, MapPin, Plane, Search,
  BedDouble, Sparkles, WalletCards, User, DollarSign, Star
} from 'lucide-react';

/* ─── API Local ──────────────────────────────────────────────────────────── */

async function fetchNominatimAutocomplete(query: string) {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`);
    const data = await res.json();
    return data.map((d: any) => ({
      name: d.display_name,
      lat: d.lat,
      lon: d.lon
    }));
  } catch (err) {
    return [];
  }
}

/* ─── Shared Logic & Types ───────────────────────────────────────────────── */

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initial;
    } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}

type AuthState = {
  isAuthenticated: boolean;
  user: { name: string } | null;
};

type OnboardingData = {
  destination: string;
  budget: number;
  currency: string;
  startDate: string;
  endDate: string;
  origin: string;
  adults: number;
  children: number;
};

type GeneratedPlan = {
  id: string;
  tier: 'Optimal' | 'Comfort' | 'Balanced' | 'Budget';
  title: string;
  description: string;
  totalCost: number;
  allocations: {
    flight: number;
    hotel: number;
    transport: number;
    food: number;
    activities: number;
  };
  hotelName: string;
  isSponsored?: boolean;
};

type ActiveTrip = OnboardingData & {
  selectedPlan: GeneratedPlan;
  budgetSpent: {
    transport: number;
    food: number;
    activities: number;
  };
  days: {
    day: number;
    date: string;
    items: { time: string; title: string; cost: number; isEditable?: boolean }[];
  }[];
};

const initialOnboarding: OnboardingData = {
  destination: '',
  budget: 2000,
  currency: 'USD',
  startDate: '',
  endDate: '',
  origin: '',
  adults: 1,
  children: 0
};

/* ─── Utils ──────────────────────────────────────────────────────────────── */

function formatMoney(amount: number, currency: string) {
  const safeCurrency = currency || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: safeCurrency, maximumFractionDigits: 0 }).format(amount || 0);
  } catch (e) {
    return `$${amount || 0}`;
  }
}

function calculateDays(start: string, end: string) {
  if (!start || !end) return 0;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function generatePlans(data: OnboardingData, days: number): GeneratedPlan[] {
  const total = data.budget;

  // Enforce sum <= Budget for all plans
  // Calculate relative costs based on tier
  const createPlan = (tier: 'Optimal' | 'Comfort' | 'Balanced' | 'Budget', multiplier: number, title: string, desc: string, hotel: string, isSponsored?: boolean): GeneratedPlan => {
    let budgetForPlan = total * multiplier;
    if (budgetForPlan > total) budgetForPlan = total;

    // Fixed % distribution roughly
    let flight = Math.floor(budgetForPlan * 0.3);
    let hotelCost = Math.floor(budgetForPlan * 0.35);
    let food = Math.floor(budgetForPlan * 0.15);
    let activities = Math.floor(budgetForPlan * 0.1);
    let transport = Math.floor(budgetForPlan * 0.05);

    // Ensure it sums exactly by adding remainder to hotel
    const sum = flight + hotelCost + food + activities + transport;
    if (sum < budgetForPlan) {
      hotelCost += (budgetForPlan - sum);
    }

    return {
      id: `plan-${tier.toLowerCase()}`,
      tier,
      title,
      description: desc,
      totalCost: flight + hotelCost + food + activities + transport,
      allocations: { flight, hotel: hotelCost, transport, food, activities },
      hotelName: hotel,
      isSponsored
    };
  };

  return [
    createPlan('Budget', 0.6, 'Backpacker Basics', 'Strictly the essentials. Perfect for saving.', 'Hostel Central'),
    createPlan('Balanced', 0.8, 'Sensible & Sweet', 'A great mix of comfort and economy.', 'City Inn'),
    createPlan('Comfort', 0.95, 'Relaxed Travel', 'More breathing room for food and activities.', 'Grand Hotel', true), // Sponsored
    createPlan('Optimal', 1.0, 'Maximized Experience', 'Uses your full budget for the best possible trip.', 'Luxury Suite')
  ];
}

const trackAffiliateClick = (provider: string, itemId: string) => {
  console.log(`[Affiliate Tracking] Clicked provider: ${provider}, item: ${itemId}`);
  const clicks = JSON.parse(localStorage.getItem('affiliate_clicks') || '[]');
  clicks.push({ provider, itemId, timestamp: new Date().toISOString() });
  localStorage.setItem('affiliate_clicks', JSON.stringify(clicks));
};

/* ─── Components ─────────────────────────────────────────────────────────── */

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

function AutocompleteInput({ value = '', onChange, placeholder, label }: { value?: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState<{name: string}[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query && query.length >= 2 && query !== value) {
        const res = await fetchNominatimAutocomplete(query);
        setResults(res);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query, value]);

  return (
    <label className="airport-autocomplete" style={{ position: 'relative', display: 'block', marginBottom: '1rem' }}>
      <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>{label}</span>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
      />
      {focused && results.length > 0 && (
        <div className="airport-results" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #eee', zIndex: 10, borderRadius: '8px', overflow: 'hidden' }}>
          {results.map((r, i) => (
            <div
              key={i}
              className="airport-result"
              style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
              onMouseDown={() => {
                setQuery(r.name);
                onChange(r.name);
                setResults([]);
              }}
            >
              {r.name}
            </div>
          ))}
        </div>
      )}
    </label>
  );
}

/* ─── Pages ──────────────────────────────────────────────────────────────── */

function Onboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [data, setData] = useStored<OnboardingData>('travel-onboarding', initialOnboarding);

  const nextStep = () => {
    if (step < 5) setStep(step + 1);
    else setLocation('/auth');
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  return (
    <div className="page" style={{ maxWidth: '600px', margin: '40px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
        {step > 1 && (
          <button className="btn btn-quiet" onClick={prevStep} style={{ marginRight: '1rem', padding: '8px' }}>
            <ArrowLeft size={18} />
          </button>
        )}
        <h2 style={{ margin: 0 }}>Step {step} of 5</h2>
      </div>

      <div className="card card-pad">
        {step === 1 && (
          <div>
            <h3>Where do you want to go?</h3>
            <p className="muted" style={{ marginBottom: '1.5rem' }}>Search for any city, country, or region.</p>
            <AutocompleteInput
              label="Destination"
              placeholder="e.g. Tokyo, Japan"
              value={data.destination}
              onChange={(v) => setData({ ...data, destination: v })}
            />
          </div>
        )}

        {step === 2 && (
          <div>
            <h3>What's your total trip budget?</h3>
            <p className="muted" style={{ marginBottom: '1.5rem' }}>This is the strict upper limit for all expenses combined.</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ flex: 1 }}>
                <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Amount</span>
                <input
                  type="number"
                  min="100"
                  value={data.budget}
                  onChange={(e) => setData({ ...data, budget: Number(e.target.value) })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
                />
              </label>
              <label>
                <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Currency</span>
                <select
                  value={data.currency}
                  onChange={(e) => setData({ ...data, currency: e.target.value })}
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3>How many days?</h3>
            <p className="muted" style={{ marginBottom: '1.5rem' }}>Select your start and end dates.</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ flex: 1 }}>
                <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Start Date</span>
                <input
                  type="date"
                  value={data.startDate}
                  onChange={(e) => setData({ ...data, startDate: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
                />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>End Date</span>
                <input
                  type="date"
                  value={data.endDate}
                  onChange={(e) => setData({ ...data, endDate: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
                />
              </label>
            </div>
            {data.startDate && data.endDate && (
              <p style={{ marginTop: '1rem', fontWeight: 'bold' }}>
                Total: {calculateDays(data.startDate, data.endDate)} days
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h3>Where are you traveling from?</h3>
            <p className="muted" style={{ marginBottom: '1.5rem' }}>We need this to estimate flight costs.</p>
            <AutocompleteInput
              label="Origin City"
              placeholder="e.g. San Francisco"
              value={data.origin}
              onChange={(v) => setData({ ...data, origin: v })}
            />
          </div>
        )}

        {step === 5 && (
          <div>
            <h3>Who's traveling?</h3>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <label style={{ flex: 1 }}>
                <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Adults</span>
                <input
                  type="number"
                  min="1"
                  value={data.adults}
                  onChange={(e) => setData({ ...data, adults: Number(e.target.value) })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
                />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Children</span>
                <input
                  type="number"
                  min="0"
                  value={data.children}
                  onChange={(e) => setData({ ...data, children: Number(e.target.value) })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
                />
              </label>
            </div>
            <p className="muted">Total travelers: {data.adults + data.children}</p>
          </div>
        )}

        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={nextStep}
            disabled={
              (step === 1 && !data.destination) ||
              (step === 2 && data.budget <= 0) ||
              (step === 3 && (!data.startDate || !data.endDate)) ||
              (step === 4 && !data.origin)
            }
          >
            {step === 5 ? 'Continue' : 'Next'} <ArrowRight size={16} style={{ marginLeft: '8px' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthGate() {
  const [, setLocation] = useLocation();
  const [, setAuth] = useStored<AuthState>('travel-auth', { isAuthenticated: false, user: null });

  const handleSignIn = () => {
    setAuth({ isAuthenticated: true, user: { name: 'Maya' } });
    setLocation('/plans');
  };

  const handleGuest = () => {
    setAuth({ isAuthenticated: false, user: null });
    setLocation('/plans');
  };

  return (
    <div className="page" style={{ maxWidth: '500px', margin: '60px auto', textAlign: 'center' }}>
      <div className="brand-mark" style={{ margin: '0 auto 24px', display: 'flex', justifyContent: 'center', width: 48, height: 48, background: 'var(--primary)', color: 'white', borderRadius: '50%', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: '20px' }}>&amp;</span>
      </div>
      <h1 style={{ marginBottom: '8px' }}>Save your progress</h1>
      <p className="muted" style={{ marginBottom: '32px' }}>Create an account to access your plans across devices.</p>
      
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button className="btn btn-primary" onClick={handleSignIn} style={{ width: '100%', justifyContent: 'center' }}>
          Sign In / Create Account
        </button>
        <button className="btn btn-quiet" onClick={handleGuest} style={{ width: '100%', justifyContent: 'center' }}>
          Continue Without Account
        </button>
      </div>
    </div>
  );
}

function PlanComparison() {
  const [, setLocation] = useLocation();
  const [data] = useStored<OnboardingData>('travel-onboarding', initialOnboarding);
  const [, setActiveTrip] = useStored<ActiveTrip | null>('travel-active-trip', null);

  const days = calculateDays(data.startDate, data.endDate);
  const plans = useMemo(() => generatePlans(data, days), [data, days]);

  const selectPlan = (plan: GeneratedPlan) => {
    // Generate dummy itinerary days
    const itineraryDays = Array.from({ length: days }).map((_, i) => ({
      day: i + 1,
      date: new Date(new Date(data.startDate).getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      items: [
        { time: '09:00', title: 'Breakfast', cost: 15, isEditable: true },
        { time: '10:30', title: 'Explore / Activity', cost: Math.round(plan.allocations.activities / days), isEditable: true },
        { time: '13:00', title: 'Lunch', cost: 20, isEditable: true },
        { time: '18:00', title: 'Dinner', cost: 35, isEditable: true }
      ]
    }));

    setActiveTrip({
      ...data,
      selectedPlan: plan,
      budgetSpent: { transport: 0, food: 0, activities: 0 },
      days: itineraryDays
    });
    
    // Simulate monetization tracking
    if (plan.isSponsored) {
      trackAffiliateClick('booking.com', plan.hotelName);
    }
    
    setLocation('/dashboard');
  };

  return (
    <div className="page">
      <PageHeading 
        eyebrow="Plan Generation" 
        title="Choose your budget strategy" 
        description={`We've crafted 4 strictly-enforced plans for ${data.destination} that fit within your ${formatMoney(data.budget, data.currency)} limit.`}
        actions={<button className="btn btn-quiet" onClick={() => setLocation('/onboarding')}><ArrowLeft /> Modify Search</button>}
      />

      <div className="option-grid grid" style={{ marginTop: '20px' }}>
        {plans.map((plan) => (
          <div className="card option-card" key={plan.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="option-card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="option-top" style={{ marginBottom: '16px' }}>
                <div>
                  <h3>{plan.title}</h3>
                  <p>{plan.description}</p>
                </div>
                <span className={`option-tag ${plan.tier === 'Optimal' ? 'primary' : ''}`}>{plan.tier}</span>
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px', color: 'hsl(var(--primary))' }}>
                  {formatMoney(plan.totalCost, data.currency)} <span style={{ fontSize: '14px', fontWeight: 'normal', color: 'var(--muted)' }}>total</span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted"><Plane size={14} style={{ verticalAlign: 'middle', marginRight: 4 }}/> Flights</span>
                    <strong>{formatMoney(plan.allocations.flight, data.currency)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">
                      <BedDouble size={14} style={{ verticalAlign: 'middle', marginRight: 4 }}/> Hotel
                      {plan.isSponsored && <span className="option-tag" style={{ marginLeft: 6, fontSize: '10px', padding: '2px 6px' }}>Sponsored</span>}
                    </span>
                    <strong>{formatMoney(plan.allocations.hotel, data.currency)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted"><circle cx="12" cy="12" r="10" /> Transport</span>
                    <strong>{formatMoney(plan.allocations.transport, data.currency)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted"><circle cx="12" cy="12" r="10" /> Food</span>
                    <strong>{formatMoney(plan.allocations.food, data.currency)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted"><Compass size={14} style={{ verticalAlign: 'middle', marginRight: 4 }}/> Activities</span>
                    <strong>{formatMoney(plan.allocations.activities, data.currency)}</strong>
                  </div>
                </div>
              </div>

              <div className="option-footer" style={{ marginTop: '24px', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => selectPlan(plan)} style={{ width: '100%', justifyContent: 'center' }}>
                  Choose This Plan
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="notice" style={{ marginTop: '30px' }}>
        <Info />
        <span>All plans are strictly enforced to remain under your {formatMoney(data.budget, data.currency)} budget constraint.</span>
      </div>
    </div>
  );
}

function Dashboard() {
  const [, setLocation] = useLocation();
  const [activeTrip, setActiveTrip] = useStored<ActiveTrip | null>('travel-active-trip', null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  if (!activeTrip) {
    return <div className="page">No active trip. <button onClick={() => setLocation('/onboarding')}>Start Planning</button></div>;
  }

  const { selectedPlan, days } = activeTrip;
  
  if (!selectedPlan || !selectedPlan.allocations) {
    return (
      <div className="page" style={{ textAlign: 'center', marginTop: '50px' }}>
        <h2>Invalid Trip Plan</h2>
        <p>Your saved trip is missing budget allocations. Please start over.</p>
        <button className="btn btn-primary" onClick={() => { localStorage.clear(); setLocation('/onboarding'); }}>Plan New Trip</button>
      </div>
    );
  }

  const currentDay = days && days.length > 0 ? days[selectedDayIndex] : null;

  if (!currentDay) {
    return (
      <div className="page" style={{ textAlign: 'center', marginTop: '50px' }}>
        <h2>Invalid Trip Dates</h2>
        <p>Your trip has no valid dates. Please create a new trip and ensure you select start and end dates.</p>
        <button className="btn btn-primary" onClick={() => setLocation('/onboarding')}>Plan New Trip</button>
      </div>
    );
  }

  // Calculate dynamic spent vs remaining
  const staticCosts = selectedPlan.allocations.flight + selectedPlan.allocations.hotel;
  const flexAllocated = selectedPlan.allocations.transport + selectedPlan.allocations.food + selectedPlan.allocations.activities;
  
  let flexSpent = 0;
  activeTrip.days.forEach(d => {
    d.items.forEach(item => {
      flexSpent += item.cost;
    });
  });

  const remainingBudget = activeTrip.budget - staticCosts - flexSpent;
  const status = remainingBudget >= 0 ? 'Within Budget' : 'Over Budget';

  const updateItemCost = (dayIdx: number, itemIdx: number, newCost: number) => {
    const newDays = [...activeTrip.days];
    newDays[dayIdx].items[itemIdx].cost = newCost;
    setActiveTrip({ ...activeTrip, days: newDays });
  };

  return (
    <div className="page">
      <div className="brief-layout" style={{ marginBottom: '30px' }}>
        <div className="hero-brief">
          <div className="hero-content">
            <div className="eyebrow">Active Trip \u00b7 {activeTrip.destination}</div>
            <h1 style={{ fontSize: '3rem', marginBottom: '16px' }}>{activeTrip.destination}</h1>
            <p>You selected the <strong>{selectedPlan.title}</strong> plan.</p>
            <div className="hero-pills">
              <span className="hero-pill">{activeTrip.startDate} — {activeTrip.endDate}</span>
              <span className="hero-pill">{activeTrip.adults + activeTrip.children} travelers</span>
            </div>
          </div>
        </div>
        <div className="brief-side">
          <div className="card stat-card">
            <div className="stat-icon"><CircleDollarSign /></div>
            <div>
              <div className="stat-value">{formatMoney(remainingBudget, activeTrip.currency)}</div>
              <div className="stat-note">Remaining flex budget</div>
            </div>
          </div>
          <div className="card stat-card" style={{ background: remainingBudget < 0 ? 'hsl(0 80% 95%)' : undefined }}>
            <div className="stat-icon"><WalletCards /></div>
            <div>
              <div className="stat-value">{status}</div>
              <div className="stat-note">Total budget: {formatMoney(activeTrip.budget, activeTrip.currency)}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
        {/* Day Selector Sidebar */}
        <div className="card" style={{ width: '250px', padding: '10px' }}>
          <h3 style={{ padding: '10px 15px', margin: 0, borderBottom: '1px solid #eee' }}>Itinerary</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0' }}>
            {days.map((day, idx) => (
              <li key={idx}>
                <button
                  onClick={() => setSelectedDayIndex(idx)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 15px',
                    background: selectedDayIndex === idx ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: selectedDayIndex === idx ? 'bold' : 'normal',
                    color: selectedDayIndex === idx ? 'hsl(var(--primary))' : 'inherit'
                  }}
                >
                  Day {day.day} <span className="muted" style={{ display: 'block', fontSize: '12px', marginTop: '2px' }}>{day.date}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Day Details */}
        <div className="card card-pad" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2>Day {currentDay.day}</h2>
            <span className="muted">{currentDay.date}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {currentDay.items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', padding: '16px', border: '1px solid #eee', borderRadius: '8px' }}>
                <div style={{ width: '80px', fontWeight: 'bold' }}>{item.time}</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0 }}>{item.title}</h4>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {item.isEditable ? (
                    <div style={{ display: 'flex', alignItems: 'center', background: '#f5f5f5', borderRadius: '4px', padding: '4px 8px' }}>
                      <span className="muted" style={{ marginRight: '4px' }}>Cost:</span>
                      <input
                        type="number"
                        min="0"
                        value={item.cost}
                        onChange={(e) => updateItemCost(selectedDayIndex, idx, Number(e.target.value))}
                        style={{ width: '60px', border: 'none', background: 'transparent', fontWeight: 'bold', textAlign: 'right' }}
                      />
                    </div>
                  ) : (
                    <strong style={{ minWidth: '60px', textAlign: 'right' }}>{item.cost === 0 ? 'Free' : formatMoney(item.cost, activeTrip.currency)}</strong>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ marginTop: '24px', padding: '16px', background: 'var(--card-alt)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
            <span>Day Total</span>
            <span>{formatMoney(currentDay.items.reduce((sum, item) => sum + item.cost, 0), activeTrip.currency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── App Root ───────────────────────────────────────────────────────────── */

function AppRoot() {
  const [activeTrip] = useStored<ActiveTrip | null>('travel-active-trip', null);
  const location = useLocation()[0];
  
  return (
    <div className="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="app-header" style={{ padding: '16px 32px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href={activeTrip ? "/dashboard" : "/onboarding"} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px', color: 'inherit' }}>
          <div className="brand-mark" style={{ background: 'var(--primary)', color: 'white', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>&amp;</div>
          <span style={{ fontWeight: 'bold', fontSize: '18px', letterSpacing: '-0.5px' }}>TraveL&amp;</span>
        </Link>
        <div style={{ display: 'flex', gap: '16px' }}>
          {activeTrip && <Link href="/dashboard" className={`btn ${location === '/dashboard' ? 'btn-primary' : 'btn-quiet'}`}>My Trip</Link>}
          <button className="btn btn-quiet" onClick={() => {
            localStorage.clear();
            window.location.href = '/onboarding';
          }}>Reset All</button>
        </div>
      </header>
      
      <main style={{ flex: 1, padding: '24px 32px' }}>
        <Switch>
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/auth" component={AuthGate} />
          <Route path="/plans" component={PlanComparison} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/">
            {() => {
              const [, setLoc] = useLocation();
              useEffect(() => {
                if (activeTrip) setLoc('/dashboard');
                else setLoc('/onboarding');
              }, [activeTrip, setLoc]);
              return null;
            }}
          </Route>
        </Switch>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <WouterRouter>
      <AppRoot />
    </WouterRouter>
  );
}
