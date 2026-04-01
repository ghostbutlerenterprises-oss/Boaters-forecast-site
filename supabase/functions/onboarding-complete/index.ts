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
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { zip_code, species, radius_miles = 50, phone = null } = await req.json()

    // Validate input
    if (!zip_code || !species || !Array.isArray(species) || species.length === 0) {
      return new Response(
        JSON.stringify({ error: 'zip_code and species array are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get user from auth header
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Create or update profile
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        phone,
        zip_code,
        radius_miles
      })

    if (profileError) throw profileError

    // Save species preferences
    const speciesInserts = species.map((s, index) => ({
      user_id: user.id,
      species: s.toLowerCase(),
      priority: index + 1
    }))

    // Delete existing species prefs and insert new ones
    await supabaseClient
      .from('user_species')
      .delete()
      .eq('user_id', user.id)

    const { error: speciesError } = await supabaseClient
      .from('user_species')
      .insert(speciesInserts)

    if (speciesError) throw speciesError

    // Find nearest spots based on zip code
    // For MVP: simple zip prefix matching, later use geocoding
    const zipPrefix = zip_code.substring(0, 3)
    const { data: nearbySpots, error: spotsError } = await supabaseClient
      .from('spots')
      .select('*')
      .or(`zip_code.like.${zipPrefix}%,region.eq.tampa-bay`) // Fallback to Tampa Bay for now
      .limit(5)

    if (spotsError) throw spotsError

    // Assign spots to user
    if (nearbySpots && nearbySpots.length > 0) {
      const spotAssignments = nearbySpots.map((spot, index) => ({
        user_id: user.id,
        spot_id: spot.id,
        is_primary: index === 0
      }))

      // Delete existing assignments
      await supabaseClient
        .from('user_spots')
        .delete()
        .eq('user_id', user.id)

      const { error: assignmentError } = await supabaseClient
        .from('user_spots')
        .insert(spotAssignments)

      if (assignmentError) throw assignmentError
    }

    // Create subscription record (trialing status)
    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 30)

    const { error: subError } = await supabaseClient
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        status: 'trialing',
        trial_ends_at: trialEndsAt.toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: trialEndsAt.toISOString()
      })

    if (subError) throw subError

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Onboarding complete',
        spots_assigned: nearbySpots?.length || 0,
        trial_ends_at: trialEndsAt.toISOString()
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
