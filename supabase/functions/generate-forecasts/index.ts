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

  // Verify admin authorization
  const authHeader = req.headers.get('authorization')
  const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authHeader || authHeader.replace('Bearer ', '') !== expectedKey) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
    )
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    // Get spots for active subscribers only (trialing or active)
    const { data: activeSpotIds, error: spotIdsError } = await supabaseClient
      .from('user_spots')
      .select('spot_id')
      .in('user_id', (
        supabaseClient
          .from('subscriptions')
          .select('user_id')
          .in('status', ['trialing', 'active'])
      ))
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

        // Fetch tide data from NOAA
        const tides = await fetchTideData(spot.latitude, spot.longitude, forecastDate)

        // Generate forecast using AI (OpenAI)
        const forecast = await generateForecastWithAI(spot, weather, marine, tides)

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

async function fetchTideData(lat: number, lon: number, startDate: string): Promise<any> {
  try {
    // Find nearest NOAA tide station
    // Using NOAA CO-OPS API - stations around Tampa Bay area
    // 8726667 = Port Manatee, 8726522 = St. Petersburg, 8726384 = Port Tampa
    const stations = [
      { id: '8726667', name: 'Port Manatee', lat: 27.6383, lon: -82.5623 },
      { id: '8726522', name: 'St. Petersburg', lat: 27.7606, lon: -82.6269 },
      { id: '8726384', name: 'Port Tampa', lat: 27.8667, lon: -82.4333 }
    ]

    // Find closest station
    const closest = stations.reduce((prev, curr) => {
      const prevDist = Math.sqrt(Math.pow(prev.lat - lat, 2) + Math.pow(prev.lon - lon, 2))
      const currDist = Math.sqrt(Math.pow(curr.lat - lat, 2) + Math.pow(curr.lon - lon, 2))
      return currDist < prevDist ? curr : prev
    })

    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 3)

    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${startDate.replace(/-/g, '')}&end_date=${endDate.toISOString().split('T')[0].replace(/-/g, '')}&station=${closest.id}&product=predictions&datum=mllw&units=english&time_zone=lst_ldt&format=json`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`NOAA API error: ${res.status}`)

    const data = await res.json()
    return {
      station: closest.name,
      predictions: data.predictions || []
    }
  } catch (error) {
    console.error('Tide fetch error:', error)
    return { station: 'Unknown', predictions: [], error: error.message }
  }
}

async function generateForecastWithAI(spot: any, weather: any, marine: any, tides: any) {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')

  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  // Format tide data for AI
  const tideSummary = tides.predictions ? tides.predictions.slice(0, 12).map((t: any) => ({
    time: t.t,
    height: parseFloat(t.v).toFixed(1)
  })) : []

  const prompt = `
Generate a fishing forecast for ${spot.name} (${spot.region}).

Weather data:
${JSON.stringify(weather.daily, null, 2)}

Hourly wind:
${JSON.stringify(weather.hourly?.windspeed_10m?.slice(0, 24), null, 2)}

Marine data:
${JSON.stringify(marine.daily, null, 2)}

Tide data from ${tides.station}:
${JSON.stringify(tideSummary, null, 2)}

Target species at this spot: ${spot.species?.join(', ') || 'general'}

Return a JSON object with this structure:
{
  "day1": {
    "date": "YYYY-MM-DD",
    "rating": 1-5,
    "wind": "direction speed-gust mph. description of how it changes",
    "sea": "height ft — description",
    "tides": "Low 6:12am (0.8ft) → High 12:44pm (2.1ft) → Low 7:15pm (0.5ft)",
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

Use the REAL tide data provided above. Format tides as: "Low HH:MMam (X.Xft) → High HH:MMpm (X.Xft) → Low HH:MMpm (X.Xft)"

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
