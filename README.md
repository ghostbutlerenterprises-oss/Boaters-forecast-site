# Local Knowledge Backend

## Setup

### 1. Create Supabase Project
1. Go to https://supabase.com
2. Create new project
3. Note the Project URL and Service Role Key

### 2. Configure Environment Variables

Create `.env` file:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
OPENAI_API_KEY=sk-...
```

### 3. Deploy Database Schema

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

Or run SQL files manually in Supabase Dashboard → SQL Editor.

### 4. Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy onboarding-complete
supabase functions deploy generate-forecasts
supabase functions deploy deliver-forecasts
supabase functions deploy stripe-webhook
```

### 5. Configure Cron Jobs

In Supabase Dashboard → Database → Cron Jobs:

**Generate Forecasts (5:30 PM ET)**
```sql
SELECT cron.schedule(
  'generate-forecasts',
  '30 21 * * *', -- 9:30 PM UTC = 5:30 PM EDT (summer) / 4:30 PM EST (winter)
  $$
  SELECT net.http_post(
    url:='https://your-project.supabase.co/functions/v1/generate-forecasts',
    headers:='{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  ) as request_id;
  $$
);
```

**Deliver Forecasts (6:00 PM ET)**
```sql
SELECT cron.schedule(
  'deliver-forecasts',
  '0 22 * * *', -- 10:00 PM UTC = 6:00 PM EDT (summer) / 5:00 PM EST (winter)
  $$
  SELECT net.http_post(
    url:='https://your-project.supabase.co/functions/v1/deliver-forecasts',
    headers:='{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  ) as request_id;
  $$
);
```

**Note:** These times use UTC. During EDT (summer), 22:00 UTC = 6:00 PM ET. During EST (winter), 22:00 UTC = 5:00 PM ET. Adjust if you need exact 6:00 PM ET year-round (would need separate cron jobs for DST transitions).

### 6. Configure Stripe Webhook

In Stripe Dashboard:
1. Go to Developers → Webhooks
2. Add endpoint: `https://your-project.supabase.co/functions/v1/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

### 7. Test

```bash
# Test onboarding
curl -X POST https://your-project.supabase.co/functions/v1/onboarding-complete \
  -H "Authorization: Bearer USER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"zip_code": "33711", "species": ["tarpon", "snook"]}'

# Test forecast generation (admin only)
curl -X POST https://your-project.supabase.co/functions/v1/generate-forecasts \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"

# Test delivery (admin only)
curl -X POST https://your-project.supabase.co/functions/v1/deliver-forecasts \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/onboarding-complete` | POST | User | Complete onboarding with zip/species |
| `/generate-forecasts` | POST | Service Role | Generate daily forecasts |
| `/deliver-forecasts` | POST | Service Role | Deliver forecasts to subscribers |
| `/stripe-webhook` | POST | Stripe | Handle Stripe events |

## Database Tables

- `profiles` — User profiles
- `user_species` — Species preferences
- `spots` — Fishing locations
- `user_spots` — User's assigned spots
- `forecasts` — Generated forecasts
- `subscriptions` — Stripe subscription sync
- `deliveries` — Delivery log

## Environment Variables Required

| Variable | Source | Purpose |
|----------|--------|---------|
| `SUPABASE_URL` | Supabase | Database connection |
| `SUPABASE_ANON_KEY` | Supabase | Client auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Admin operations |
| `STRIPE_SECRET_KEY` | Stripe | Payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Webhook verification |
| `RESEND_API_KEY` | Resend | Email delivery |
| `TWILIO_ACCOUNT_SID` | Twilio | SMS |
| `TWILIO_AUTH_TOKEN` | Twilio | SMS |
| `TWILIO_PHONE_NUMBER` | Twilio | SMS sender |
| `OPENAI_API_KEY` | OpenAI | Forecast generation |
