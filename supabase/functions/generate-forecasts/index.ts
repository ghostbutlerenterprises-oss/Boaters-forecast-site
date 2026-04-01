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

    // Get all active spots that have subscribers
    const { data: activeSpotIds, error: spotIdsError } = await supabaseClient
      .from('user_spots')
      .select('spot_id')
      .distinct()

    if (spotIdsError) throw spotIdsError

    if (!activeSpotIds || activeSpotIds.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active spots to generate forecasts for' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const spotIds = activeSpotIds.map(s => s.spot_id)

    // Get spot details
    const { data: spots, error: spotsError } = await supabaseClient
      .from('spots')
      .select('*')
      .in('id', spotIds)

    if (spotsError) throw spotsError

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const forecastDate = tomorrow.toISOString().split('T')[0]

    const results = []

    for (const spot of spots || []) {
      try {
        // Fetch weather data from Open-Meteo
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}&daily=temperature_2m_max,windspeed_10m_max,winddirection_10m_dominant&hourly=windspeed_10m,winddirection_10m&timezone=America/New_York&forecast_days=3`
        
        const weatherRes = await fetch(weatherUrl)
        const weather = await weatherRes.json()

        // Fetch marine data
        const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${spot.latitude}&longitude=${spot.longitude}&daily=wave_height_max&timezone=America/New_York&forecast_days=3`
        
        const marineRes = await fetch(marineUrl)
        const marine = await marineRes.json()

        // Generate forecast using AI (OpenAI)
        const forecast = await generateForecastWithAI(spot, weather, marine)

        // Save forecast to database
        const { error: insertError } = await supabaseClient
          .from('forecasts')
          .upsert({
            spot_id: spot.id,
            forecast_date: forecastDate,
            day_1: forecast.day1,
            day_2: forecast.day2,
            day_3: forecast.day3,
            captains_call: forecast.captainsCall
          }, { onConflict: 'spot_id,forecast_date' })

        if (insertError) throw insertError

        results.push({ spot: spot.name, status: 'success' })

      } catch (error) {
        console.error(`Error generating forecast for ${spot.name}:`, error)
        results.push({ spot: spot.name, status: 'error', error: error.message })
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Forecast generation complete',
        forecast_date: forecastDate,
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

async function generateForecastWithAI(spot: any, weather: any, marine: any) {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const prompt = `
Generate a fishing forecast for ${spot.name} (${spot.region}).

Weather data:
${JSON.stringify(weather.daily, null, 2)}

Hourly wind:
${JSON.stringify(weather.hourly?.windspeed_10m?.slice(0, 24), null, 2)}

Marine data:
${JSON.stringify(marine.daily, null, 2)}

Target species at this spot: ${spot.species?.join(', ') || 'general'}

Return a JSON object with this structure:
{
  "day1": {
    "date": "YYYY-MM-DD",
    "rating": 1-5,
    "wind": "direction speed-gust mph. description of how it changes",
    "sea": "height ft — description",
    "tides": "Low time → High time (height) → Low time",
    "assessment": "specific fishing advice for the target species"
  },
  "day2": { same structure },
  "day3": { same structure },
  "captainsCall": "clear recommendation: fish it, skip it, or wait for the window"
}

Star rating guide:
1 = Skip it — unfishable
2 = Marginal — you could force it
3 = Worth fishing — timing matters
4 = Good day — multiple windows
5 = Exceptional — rare perfect conditions

Focus on species-specific behavior:
- Tarpon hate wind over 15mph, prefer calm seas
- Snook want moving water on falling tides
- Redfish feed aggressively on high tides over grass
- Trout prefer low light, wind-protected areas

Be conversational but specific. Include exact times when relevant.
`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  })

  const data = await response.json()
  const content = data.choices[0].message.content
  
  return JSON.parse(content)
}
