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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER')

    // Get tomorrow's date
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const forecastDate = tomorrow.toISOString().split('T')[0]
    const formattedDate = tomorrow.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    })

    // Get all active subscribers
    const { data: subscribers, error: subError } = await supabaseClient
      .from('subscriptions')
      .select(`
        user_id,
        status,
        profiles:user_id (email, phone, zip_code),
        user_species:user_id (species)
      `)
      .in('status', ['trialing', 'active'])
      .gt('current_period_end', new Date().toISOString())

    if (subError) throw subError

    if (!subscribers || subscribers.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active subscribers' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const results = []

    for (const sub of subscribers) {
      try {
        const user = sub.profiles
        const species = sub.user_species?.map((s: any) => s.species) || []

        // Get user's spots
        const { data: userSpots, error: spotsError } = await supabaseClient
          .from('user_spots')
          .select(`
            spot_id,
            is_primary,
            spots:spot_id (*)
          `)
          .eq('user_id', sub.user_id)

        if (spotsError) throw spotsError

        if (!userSpots || userSpots.length === 0) {
          results.push({ user: user.email, status: 'skipped', reason: 'no spots assigned' })
          continue
        }

        // Get forecasts for user's spots
        const spotIds = userSpots.map((us: any) => us.spot_id)
        const { data: forecasts, error: forecastError } = await supabaseClient
          .from('forecasts')
          .select('*')
          .in('spot_id', spotIds)
          .eq('forecast_date', forecastDate)

        if (forecastError) throw forecastError

        if (!forecasts || forecasts.length === 0) {
          results.push({ user: user.email, status: 'skipped', reason: 'no forecasts generated' })
          continue
        }

        // Build email content
        const emailHtml = buildEmailHtml({
          user,
          species,
          spots: userSpots.map((us: any) => us.spots),
          forecasts,
          formattedDate
        })

        // Send email via Resend
        if (resendKey) {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Local Knowledge <forecasts@localknowledge.fish>',
              to: user.email,
              subject: `🎣 ${formattedDate} — Your Florida Fishing Forecast`,
              html: emailHtml
            })
          })

          if (!emailRes.ok) {
            throw new Error(`Email failed: ${await emailRes.text()}`)
          }
        }

        // Log delivery
        await supabaseClient
          .from('deliveries')
          .insert({
            user_id: sub.user_id,
            forecast_id: forecasts[0].id,
            channel: 'email',
            status: 'sent'
          })

        // Check for 4-star days and send SMS
        const hasFourStar = forecasts.some((f: any) => 
          f.day_1?.rating >= 4 || f.day_2?.rating >= 4 || f.day_3?.rating >= 4
        )

        if (hasFourStar && user.phone && twilioSid && twilioToken) {
          const fourStarSpots = forecasts
            .filter((f: any) => f.day_1?.rating >= 4)
            .map((f: any) => {
              const spot = userSpots.find((us: any) => us.spot_id === f.spot_id)
              return spot?.spots?.name
            })
            .filter(Boolean)

          const smsBody = `Local Knowledge Alert ⭐⭐⭐⭐\n\nExceptional conditions tomorrow at:\n${fourStarSpots.join(', ')}\n\nFull forecast in your email.`

          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              To: user.phone,
              From: twilioPhone || '',
              Body: smsBody
            })
          })

          await supabaseClient
            .from('deliveries')
            .insert({
              user_id: sub.user_id,
              forecast_id: forecasts[0].id,
              channel: 'sms',
              status: 'sent'
            })
        }

        results.push({ user: user.email, status: 'delivered', sms: hasFourStar && !!user.phone })

      } catch (error) {
        console.error(`Error delivering to ${sub.profiles?.email}:`, error)
        results.push({ user: sub.profiles?.email, status: 'error', error: error.message })
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Delivery complete',
        forecast_date: forecastDate,
        total_subscribers: subscribers.length,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

function buildEmailHtml({ user, species, spots, forecasts, formattedDate }: any) {
  const primarySpot = spots.find((s: any) => 
    forecasts.some((f: any) => f.spot_id === s.id)
  )
  
  const primaryForecast = forecasts.find((f: any) => f.spot_id === primarySpot?.id)

  const day1 = primaryForecast?.day_1
  const day2 = primaryForecast?.day_2
  const day3 = primaryForecast?.day_3

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Florida Fishing Forecast</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
    h1 { font-size: 28px; font-weight: 700; margin: 8px 0; }
    .date { color: #666; }
    .forecast-box { background: #1a1a1a; color: white; padding: 32px; border-radius: 16px; margin: 24px 0; }
    .day-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #333; }
    .day-name { font-size: 18px; font-weight: 600; }
    .stars { font-size: 20px; letter-spacing: 4px; }
    .detail { margin-bottom: 12px; font-size: 15px; color: #ccc; }
    .detail strong { color: white; }
    .captains-call { background: #0066ff; color: white; padding: 24px; border-radius: 12px; margin-top: 24px; }
    .captains-call-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 8px; opacity: 0.8; }
    .captains-call-text { font-size: 16px; font-weight: 600; }
    .footer { text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e5e5; color: #888; font-size: 14px; }
    .footer a { color: #0066ff; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Local Knowledge</div>
    <h1>Your Fishing Forecast</h1>
    <div class="date">${formattedDate}</div>
  </div>
  
  <div class="forecast-box">
    <div class="day-header">
      <span class="day-name">${primarySpot?.name || 'Your Local Spot'}</span>
      <span class="stars">${'⭐'.repeat(day1?.rating || 3)} (${day1?.rating || 3}/5)</span>
    </div>
    
    <div class="detail"><strong>Wind:</strong> ${day1?.wind || 'Data unavailable'}</div>
    <div class="detail"><strong>Sea:</strong> ${day1?.sea || 'Data unavailable'}</div>
    <div class="detail"><strong>Tides:</strong> ${day1?.tides || 'Data unavailable'}</div>
    <div class="detail"><strong>Assessment:</strong> ${day1?.assessment || 'Check back later'}</div>
    
    <div class="captains-call">
      <div class="captains-call-label">Captain's Call</div>
      <div class="captains-call-text">${primaryForecast?.captains_call || 'Check conditions before heading out.'}</div>
    </div>
  </div>
  
  <div class="footer">
    <p>You're receiving this because you subscribed to Local Knowledge.</p>
    <p><a href="#">Manage preferences</a> · <a href="#">Unsubscribe</a></p>
  </div>
</body>
</html>
  `
}
