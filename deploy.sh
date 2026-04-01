#!/bin/bash
# Local Knowledge Deployment Script
# Usage: ./deploy.sh [environment]
# Environments: dev, staging, prod

set -e

ENV=${1:-dev}
echo "🚀 Deploying Local Knowledge to $ENV..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v supabase &> /dev/null; then
    echo -e "${RED}❌ Supabase CLI not found. Install with: npm install -g supabase${NC}"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found${NC}"
    exit 1
fi

# Load environment variables
if [ -f ".env.$ENV" ]; then
    echo "📂 Loading .env.$ENV"
    export $(cat .env.$ENV | xargs)
elif [ -f ".env" ]; then
    echo "📂 Loading .env"
    export $(cat .env | xargs)
else
    echo -e "${YELLOW}⚠️  No .env file found. Make sure environment variables are set.${NC}"
fi

# Verify required env vars
required_vars=("SUPABASE_URL" "SUPABASE_SERVICE_ROLE_KEY" "STRIPE_SECRET_KEY")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Required environment variable $var is not set${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Deploy database migrations
echo ""
echo "🗄️  Deploying database migrations..."
supabase db push

# Deploy edge functions
echo ""
echo "⚡ Deploying edge functions..."

functions=(
    "onboarding-complete"
    "generate-forecasts"
    "deliver-forecasts"
    "stripe-webhook"
    "send-email"
)

for func in "${functions[@]}"; do
    echo "  📦 Deploying $func..."
    supabase functions deploy $func --no-verify-jwt
done

# Set environment variables for functions
echo ""
echo "🔧 Setting function environment variables..."

supabase secrets set --env-file .env.$ENV 2>/dev/null || supabase secrets set --env-file .env

# Deploy frontend (GitHub Pages)
echo ""
echo "🌐 Deploying frontend to GitHub Pages..."

cd ../local-knowledge-site

git add .
git commit -m "Deploy to $ENV: $(date '+%Y-%m-%d %H:%M:%S')" || true
git push origin main

cd ../local-knowledge/backend

# Setup cron jobs (production only)
if [ "$ENV" = "prod" ]; then
    echo ""
    echo "⏰ Setting up cron jobs..."
    
    # Generate forecasts at 5:30 PM ET (21:30 UTC)
    supabase sql < <(cat <<EOF
SELECT cron.schedule(
  'generate-forecasts',
  '30 21 * * *',
  \$\$
  SELECT net.http_post(
    url:='${SUPABASE_URL}/functions/v1/generate-forecasts',
    headers:='{"Authorization": "Bearer ${SUPABASE_SERVICE_ROLE_KEY}"}'::jsonb
  ) as request_id;
  \$\$
);
EOF
)
    
    # Deliver forecasts at 6:00 PM ET (22:00 UTC)
    supabase sql < <(cat <<EOF
SELECT cron.schedule(
  'deliver-forecasts',
  '0 22 * * *',
  \$\$
  SELECT net.http_post(
    url:='${SUPABASE_URL}/functions/v1/deliver-forecasts',
    headers:='{"Authorization": "Bearer ${SUPABASE_SERVICE_ROLE_KEY}"}'::jsonb
  ) as request_id;
  \$\$
);
EOF
)
    
    echo -e "${GREEN}✅ Cron jobs configured${NC}"
fi

# Verify deployment
echo ""
echo "🔍 Verifying deployment..."

# Check functions are deployed
for func in "${functions[@]}"; do
    status=$(supabase functions list | grep "$func" | awk '{print $2}')
    if [ "$status" = "DEPLOYED" ]; then
        echo -e "  ${GREEN}✅ $func${NC}"
    else
        echo -e "  ${YELLOW}⚠️  $func - status: $status${NC}"
    fi
done

echo ""
echo -e "${GREEN}🎉 Deployment to $ENV complete!${NC}"
echo ""
echo "📊 Dashboard: https://ghostbutlerenterprises-oss.github.io/local-knowledge-site/admin.html"
echo "🎣 Landing:   https://ghostbutlerenterprises-oss.github.io/local-knowledge-site/"
echo ""

# Post-deployment checklist
echo "📋 Post-deployment checklist:"
echo "  ☐ Test signup flow"
echo "  ☐ Test Stripe checkout"
echo "  ☐ Verify email delivery"
echo "  ☐ Check cron job execution"
echo "  ☐ Monitor error logs"
