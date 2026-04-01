# Local Knowledge API Documentation

## Base URL

```
https://your-project.supabase.co/functions/v1
```

## Authentication

All endpoints except webhooks require authentication via Bearer token:

```
Authorization: Bearer <jwt_token>
```

Get JWT token from Supabase Auth after login.

---

## Endpoints

### 1. Onboarding

Complete user onboarding with zip code and species preferences.

**Endpoint:** `POST /onboarding-complete`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "zip_code": "33711",
  "species": ["tarpon", "snook", "redfish"],
  "radius_miles": 50,
  "phone": "+15551234567"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Onboarding complete",
  "spots_assigned": 5,
  "trial_ends_at": "2026-05-01T00:00:00Z"
}
```

**Response (400):**
```json
{
  "error": "zip_code and species array are required"
}
```

**Response (401):**
```json
{
  "error": "Unauthorized"
}
```

---

### 2. Generate Forecasts

Generate daily forecasts for all active spots. Admin only.

**Endpoint:** `POST /generate-forecasts`

**Headers:**
```
Authorization: Bearer <service_role_key>
```

**Response (200):**
```json
{
  "message": "Forecast generation complete",
  "forecast_date": "2026-04-01",
  "results": [
    { "spot": "Sunshine Skyway Bridge", "status": "success" },
    { "spot": "Fort De Soto", "status": "success" },
    { "spot": "Weedon Island", "status": "error", "error": "API timeout" }
  ]
}
```

---

### 3. Deliver Forecasts

Send forecasts to all active subscribers. Admin only.

**Endpoint:** `POST /deliver-forecasts`

**Headers:**
```
Authorization: Bearer <service_role_key>
```

**Response (200):**
```json
{
  "message": "Delivery complete",
  "forecast_date": "2026-04-01",
  "total_subscribers": 42,
  "results": [
    { "user": "user@example.com", "status": "delivered", "sms": true },
    { "user": "user2@example.com", "status": "error", "error": "Invalid email" }
  ]
}
```

---

### 4. Stripe Webhook

Handle Stripe subscription events.

**Endpoint:** `POST /stripe-webhook`

**Headers:**
```
Stripe-Signature: <signature>
```

**Events Handled:**
- `checkout.session.completed` — Create subscription
- `invoice.paid` — Activate subscription
- `invoice.payment_failed` — Mark past due
- `customer.subscription.deleted` — Cancel subscription

**Response (200):**
```json
{
  "received": true
}
```

---

## Database Tables

### profiles
```sql
id UUID PRIMARY KEY
email TEXT
phone TEXT
zip_code TEXT
radius_miles INTEGER
created_at TIMESTAMP
updated_at TIMESTAMP
```

### user_species
```sql
id UUID PRIMARY KEY
user_id UUID -> profiles.id
species TEXT
priority INTEGER
created_at TIMESTAMP
```

### spots
```sql
id UUID PRIMARY KEY
name TEXT
latitude DECIMAL
longitude DECIMAL
zip_code TEXT
region TEXT
type TEXT
species TEXT[]
description TEXT
created_at TIMESTAMP
```

### forecasts
```sql
id UUID PRIMARY KEY
spot_id UUID -> spots.id
forecast_date DATE
day_1 JSONB
day_2 JSONB
day_3 JSONB
captains_call TEXT
generated_at TIMESTAMP
```

### subscriptions
```sql
id UUID PRIMARY KEY
user_id UUID -> auth.users.id
stripe_customer_id TEXT
stripe_subscription_id TEXT
status TEXT
trial_ends_at TIMESTAMP
current_period_start TIMESTAMP
current_period_end TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## Client SDK Usage

### Supabase JavaScript Client

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)

// Auth
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})

// Call edge function
const { data, error } = await supabase.functions.invoke('onboarding-complete', {
  body: { zip_code: '33711', species: ['tarpon'] }
})

// Query database
const { data: forecasts } = await supabase
  .from('forecasts')
  .select('*')
  .eq('spot_id', spotId)
  .eq('forecast_date', '2026-04-01')
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request — invalid parameters |
| 401 | Unauthorized — missing or invalid token |
| 403 | Forbidden — insufficient permissions |
| 404 | Not found |
| 500 | Server error |

---

## Rate Limits

- Auth endpoints: 10 requests per minute per IP
- Edge functions: 100 requests per minute per user
- Database: 1000 requests per minute per user

---

## Environment Variables

Required for deployment:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

RESEND_API_KEY=re_...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

OPENAI_API_KEY=sk-...
```
