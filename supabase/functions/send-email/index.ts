import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      throw new Error('RESEND_API_KEY not configured')
    }

    const { to, type, data } = await req.json()

    let subject, html

    switch (type) {
      case 'welcome':
        subject = 'Welcome to Local Knowledge — Your first forecast arrives tomorrow'
        html = buildWelcomeEmail(data)
        break
      case 'trial-ending':
        subject = 'Your free trial ends in 5 days'
        html = buildTrialEndingEmail(data)
        break
      case 'payment-failed':
        subject = 'Payment failed — please update your billing info'
        html = buildPaymentFailedEmail(data)
        break
      case 'subscription-cancelled':
        subject = 'Your subscription has been cancelled'
        html = buildCancellationEmail(data)
        break
      default:
        throw new Error('Unknown email type')
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Local Knowledge <forecasts@localknowledge.fish>',
        to,
        subject,
        html
      })
    })

    if (!response.ok) {
      throw new Error(`Resend error: ${await response.text()}`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

function buildWelcomeEmail(data: any) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Local Knowledge</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
    h1 { font-size: 28px; font-weight: 700; margin: 8px 0; }
    .content { background: #f8f9fa; padding: 32px; border-radius: 12px; }
    .tip { background: #e8f4fd; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0066ff; }
    .footer { text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e5e5; color: #888; font-size: 14px; }
    .btn { display: inline-block; background: #0066ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Local Knowledge</div>
    <h1>Welcome aboard!</h1>
  </div>
  
  <div class="content">
    <p>Hey ${data.name || 'there'},</p>
    
    <p>Welcome to Local Knowledge. You're now set up to receive daily fishing forecasts for your area.</p>
    
    <div class="tip">
      <strong>Quick tip:</strong> Your first forecast arrives tomorrow at 6:00 PM ET. It'll cover the next 3 days so you can plan ahead.
    </div>
    
    <p><strong>What to expect:</strong></p>
    <ul>
      <li>Star-rated conditions (1-5) for each day</li>
      <li>Wind, sea, and tide details</li>
      <li>Species-specific recommendations</li>
      <li>The Captain's Call — our clear fish/don't fish verdict</li>
    </ul>
    
    <p style="text-align: center; margin-top: 24px;">
      <a href="${data.dashboardUrl}" class="btn">Go to Your Dashboard</a>
    </p>
  </div>
  
  <div class="footer">
    <p>You're receiving this because you signed up for Local Knowledge.</p>
    <p><a href="${data.dashboardUrl}">Manage preferences</a> · <a href="${data.unsubscribeUrl}">Unsubscribe</a></p>
  </div>
</body>
</html>
  `
}

function buildTrialEndingEmail(data: any) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
    h1 { font-size: 28px; font-weight: 700; margin: 8px 0; }
    .content { background: #f8f9fa; padding: 32px; border-radius: 12px; }
    .warning { background: #fff3cd; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #ffc107; }
    .btn { display: inline-block; background: #0066ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .footer { text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e5e5; color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Local Knowledge</div>
    <h1>Your trial ends soon</h1>
  </div>
  
  <div class="content">
    <p>Hey ${data.name || 'there'},</p>
    
    <p>Your 30-day free trial ends in 5 days (${data.trialEndsAt}).</p>
    
    <div class="warning">
      <strong>What happens next:</strong> On ${data.trialEndsAt}, your card will be charged $5 for your first month. Then $5/month after that.
    </div>
    
    <p><strong>Not ready to commit?</strong></p>
    <p>No problem. You can cancel anytime before ${data.trialEndsAt} and you won't be charged.</p>
    
    <p style="text-align: center; margin-top: 24px;">
      <a href="${data.billingUrl}" class="btn">Manage Subscription</a>
    </p>
  </div>
  
  <div class="footer">
    <p>Questions? Reply to this email — we read every response.</p>
  </div>
</body>
</html>
  `
}

function buildPaymentFailedEmail(data: any) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
    h1 { font-size: 28px; font-weight: 700; margin: 8px 0; }
    .content { background: #f8f9fa; padding: 32px; border-radius: 12px; }
    .error { background: #fee; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #c00; }
    .btn { display: inline-block; background: #0066ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .footer { text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e5e5; color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Local Knowledge</div>
    <h1>Payment failed</h1>
  </div>
  
  <div class="content">
    <p>Hey ${data.name || 'there'},</p>
    
    <p>We couldn't process your monthly payment of $5. This usually happens when:</p>
    <ul>
      <li>Your card expired</li>
      <li>Your bank declined the charge</li>
      <li>There are insufficient funds</li>
    </ul>
    
    <div class="error">
      <strong>Please update your billing info</strong> to avoid interruption to your forecasts.
    </div>
    
    <p style="text-align: center; margin-top: 24px;">
      <a href="${data.billingUrl}" class="btn">Update Payment Method</a>
    </p>
  </div>
  
  <div class="footer">
    <p>Need help? Reply to this email.</p>
  </div>
</body>
</html>
  `
}

function buildCancellationEmail(data: any) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
    h1 { font-size: 28px; font-weight: 700; margin: 8px 0; }
    .content { background: #f8f9fa; padding: 32px; border-radius: 12px; }
    .footer { text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e5e5; color: #888; font-size: 14px; }
    .btn { display: inline-block; background: #0066ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Local Knowledge</div>
    <h1>You're unsubscribed</h1>
  </div>
  
  <div class="content">
    <p>Hey ${data.name || 'there'},</p>
    
    <p>Your Local Knowledge subscription has been cancelled.</p>
    
    <p><strong>What this means:</strong></p>
    <ul>
      <li>You'll keep access until ${data.accessEndsAt}</li>
      <li>No more charges to your card</li>
      <li>Your forecasts will stop after ${data.accessEndsAt}</li>
    </ul>
    
    <p><strong>Why we're bummed:</strong></p>
    <p>We clearly didn't deliver. If you have 30 seconds, reply and tell us why — we actually read every response and use it to improve.</p>
    
    <p style="text-align: center; margin-top: 24px;">
      <a href="${data.resubscribeUrl}" class="btn">Resubscribe Anytime</a>
    </p>
  </div>
  
  <div class="footer">
    <p>Thanks for giving us a shot. Tight lines.</p>
  </div>
</body>
</html>
  `
}
