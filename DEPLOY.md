# Local Knowledge Deployment Guide

## Prerequisites

1. **Supabase CLI**
   ```bash
   npm install -g supabase
   ```

2. **Git**
   ```bash
   git --version  # Should be 2.0+
   ```

3. **Environment Variables**
   Create `.env` file:
   ```bash
   cp .env.example .env
   # Edit with your values
   ```

## Quick Deploy

```bash
# Deploy everything
./deploy.sh prod

# Or deploy to dev
./deploy.sh dev
```

## Manual Deployment Steps

### 1. Database

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### 2. Edge Functions

```bash
# Deploy all functions
supabase functions deploy onboarding-complete
supabase functions deploy generate-forecasts
supabase functions deploy deliver-forecasts
supabase functions deploy stripe-webhook
supabase functions deploy send-email

# Set secrets
supabase secrets set --env-file .env
```

### 3. Frontend

```bash
cd ../local-knowledge-site
git add .
git commit -m "Deploy"
git push origin main
```

### 4. Cron Jobs (Production)

Run in Supabase SQL Editor:

```sql
-- Generate forecasts at 5:30 PM ET
SELECT cron.schedule(
  'generate-forecasts',
  '30 21 * * *',
  $$
  SELECT net.http_post(
    url:='https://your-project.supabase.co/functions/v1/generate-forecasts',
    headers:='{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  ) as request_id;
  $$
);

-- Deliver forecasts at 6:00 PM ET
SELECT cron.schedule(
  'deliver-forecasts',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url:='https://your-project.supabase.co/functions/v1/deliver-forecasts',
    headers:='{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  ) as request_id;
  $$
);
```

## Environment Setup

### Development

```bash
# Local Supabase
supabase start

# Serve functions locally
supabase functions serve

# Test locally
curl http://localhost:54321/functions/v1/onboarding-complete \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

### Production

1. Create production project in Supabase
2. Set all environment variables
3. Run deployment script
4. Configure Stripe webhook
5. Test end-to-end

## Stripe Configuration

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-project.supabase.co/functions/v1/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

## Testing

```bash
# Test onboarding
curl -X POST https://your-project.supabase.co/functions/v1/onboarding-complete \
  -H "Authorization: Bearer USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"zip_code": "33711", "species": ["tarpon"]}'

# Test forecast generation (admin)
curl -X POST https://your-project.supabase.co/functions/v1/generate-forecasts \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"

# Test delivery (admin)
curl -X POST https://your-project.supabase.co/functions/v1/deliver-forecasts \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

## Monitoring

### Logs
```bash
# Function logs
supabase functions logs generate-forecasts

# Database logs
supabase postgres logs
```

### Health Checks
- Landing page loads
- Checkout flow completes
- Stripe webhook receives events
- Daily forecasts generate
- Emails deliver

## Rollback

```bash
# Revert to previous git commit
git revert HEAD
git push

# Or restore database
supabase db reset
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Functions fail to deploy | Check `supabase/config.toml` |
| Database push fails | Check migration syntax |
| Stripe webhooks fail | Verify webhook secret |
| Emails not sending | Check Resend API key |
| Cron jobs not running | Check `pg_cron` extension enabled |

## Support

- Supabase Docs: https://supabase.com/docs
- Stripe Docs: https://stripe.com/docs
- OpenAI Docs: https://platform.openai.com/docs
