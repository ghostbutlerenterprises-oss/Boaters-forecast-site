# Local Knowledge — Backend Architecture

## Tech Stack

| Component | Tool | Why |
|-----------|------|-----|
| Database | Supabase (PostgreSQL) | Auth included, realtime, generous free tier |
| API | Supabase Edge Functions | Serverless, TypeScript, colocated with data |
| Auth | Supabase Auth | Email/password + OAuth (Google, etc.) |
| Email | Resend | Clean API, good deliverability, free tier |
| SMS | Twilio | Industry standard, reliable |
| Payments | Stripe | Subscription handling, webhooks |
| Hosting | Supabase + Vercel | Edge functions + static frontend |

## Database Schema

```sql
-- Users (managed by Supabase Auth, extended with metadata)
-- Using auth.users, no separate table needed

-- User profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  phone TEXT, -- for SMS alerts
  zip_code TEXT NOT NULL,
  radius_miles INTEGER DEFAULT 50, -- how far they'll drive
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User species preferences (many-to-many)
CREATE TABLE user_species (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  species TEXT NOT NULL, -- 'tarpon', 'snook', 'redfish', etc.
  priority INTEGER DEFAULT 1, -- 1 = primary target
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, species)
);

-- Fishing spots (pre-populated database)
CREATE TABLE spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  zip_code TEXT NOT NULL, -- nearest zip
  region TEXT NOT NULL, -- 'tampa-bay', 'naples', 'pensacola', etc.
  type TEXT NOT NULL, -- 'inshore', 'offshore', 'bridge', 'flat'
  species TEXT[], -- which species are found here
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User spot assignments (which spots they get forecasts for)
CREATE TABLE user_spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  spot_id UUID REFERENCES spots(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, spot_id)
);

-- Daily forecasts (generated and stored)
CREATE TABLE forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id UUID REFERENCES spots(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  day_1 JSONB NOT NULL, -- { date, rating, wind, sea, tides, assessment }
  day_2 JSONB NOT NULL,
  day_3 JSONB NOT NULL,
  captains_call TEXT NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(spot_id, forecast_date)
);

-- Subscriptions (synced with Stripe)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL, -- 'trialing', 'active', 'cancelled', 'past_due'
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Delivery log (track what was sent)
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  forecast_id UUID REFERENCES forecasts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, -- 'email', 'sms'
  status TEXT NOT NULL, -- 'sent', 'delivered', 'failed'
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_spots_zip ON spots(zip_code);
CREATE INDEX idx_spots_region ON spots(region);
CREATE INDEX idx_user_spots_user ON user_spots(user_id);
CREATE INDEX idx_forecasts_spot_date ON forecasts(spot_id, forecast_date);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

## API Endpoints (Edge Functions)

### Auth Flow
- `POST /auth/signup` — Create account, trigger welcome email
- `POST /auth/login` — Standard login
- `POST /auth/reset-password` — Password reset

### Onboarding (post-signup)
- `POST /onboarding/complete` — Submit zip code + species preferences
  - Input: `{ zip_code, species: ['tarpon', 'snook'], radius_miles, phone? }`
  - Action: Create profile, assign nearest spots, save species prefs

### User Management
- `GET /user/profile` — Get current user profile
- `PATCH /user/profile` — Update zip, radius, phone
- `GET /user/species` — Get user's target species
- `POST /user/species` — Add/update species
- `DELETE /user/species/:id` — Remove species
- `GET /user/spots` — Get user's assigned spots
- `POST /user/spots` — Add a spot manually

### Forecasts
- `GET /forecasts/today` — Get today's forecast for user's spots
- `GET /forecasts/history` — Get past forecasts (last 30 days)

### Stripe Webhooks
- `POST /webhooks/stripe` — Handle subscription events

## Daily Forecast Generation Job

```typescript
// Edge function: generate-forecasts
// Triggered by cron at 5:30 PM ET (30 min before delivery)

async function generateForecasts() {
  // 1. Get all active spots that have subscribers
  const activeSpots = await db.spots
    .select('*')
    .whereIn('id', db.user_spots.select('spot_id').distinct());
  
  // 2. For each spot, fetch weather + tide data
  for (const spot of activeSpots) {
    const weather = await fetchOpenMeteo(spot.latitude, spot.longitude);
    const tides = await fetchWillyWeather(spot.latitude, spot.longitude);
    
    // 3. Generate forecast with AI or rules
    const forecast = await generateForecastWithAI({
      spot,
      weather,
      tides,
      species: getSpeciesForSpot(spot)
    });
    
    // 4. Save to database
    await db.forecasts.insert({
      spot_id: spot.id,
      forecast_date: tomorrow(),
      ...forecast
    });
  }
}
```

## Daily Delivery Job

```typescript
// Edge function: deliver-forecasts
// Triggered by cron at 6:00 PM ET

async function deliverForecasts() {
  // 1. Get all active subscribers
  const subscribers = await db.subscriptions
    .select('user_id')
    .whereIn('status', ['trialing', 'active'])
    .where('current_period_end', '>', now());
  
  // 2. For each subscriber, get their forecasts
  for (const sub of subscribers) {
    const user = await db.profiles.find(sub.user_id);
    const spots = await db.user_spots
      .select('spots.*')
      .join('spots', 'spots.id', 'user_spots.spot_id')
      .where('user_spots.user_id', sub.user_id);
    
    const forecasts = await db.forecasts
      .whereIn('spot_id', spots.map(s => s.id))
      .where('forecast_date', tomorrow());
    
    // 3. Build personalized email
    const emailContent = buildEmail({
      user,
      spots,
      forecasts,
      species: await db.user_species.where('user_id', user.id)
    });
    
    // 4. Send email
    await resend.emails.send({
      to: user.email,
      subject: `🎣 ${tomorrowFormatted()} — Your Florida Fishing Forecast`,
      html: emailContent
    });
    
    // 5. Check for 4-star days, send SMS if applicable
    const fourStarDays = forecasts.filter(f => hasFourStarDay(f));
    if (fourStarDays.length > 0 && user.phone) {
      await twilio.messages.create({
        to: user.phone,
        body: buildSMSAlert(fourStarDays)
      });
    }
    
    // 6. Log delivery
    await db.deliveries.insert({
      user_id: user.id,
      forecast_id: forecasts[0].id,
      channel: 'email',
      status: 'sent'
    });
  }
}
```

## File Structure

```
backend/
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_add_spots_data.sql
│   │   └── 003_add_indexes.sql
│   ├── functions/
│   │   ├── auth-signup/
│   │   │   └── index.ts
│   │   ├── onboarding-complete/
│   │   │   └── index.ts
│   │   ├── user-profile/
│   │   │   └── index.ts
│   │   ├── generate-forecasts/
│   │   │   └── index.ts
│   │   ├── deliver-forecasts/
│   │   │   └── index.ts
│   │   └── stripe-webhook/
│   │       └── index.ts
│   └── config.toml
├── src/
│   ├── lib/
│   │   ├── openmeteo.ts
│   │   ├── willyweather.ts
│   │   ├── forecast-generator.ts
│   │   ├── email-builder.ts
│   │   └── sms-builder.ts
│   └── types/
│       └── index.ts
├── package.json
└── README.md
```

## Environment Variables

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=

# Resend (email)
RESEND_API_KEY=
RESEND_FROM_EMAIL=forecasts@localknowledge.fish

# Twilio (SMS)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# OpenAI (for forecast generation)
OPENAI_API_KEY=
```

## Next Steps

1. **Create Supabase project** — 5 minutes
2. **Run migrations** — Set up database schema
3. **Seed spots data** — Add Florida fishing spots
4. **Create edge functions** — Start with auth and onboarding
5. **Stripe integration** — Set up checkout and webhooks
6. **Test end-to-end** — Sign up → onboard → receive forecast

Want me to start with the Supabase project setup and migrations?
