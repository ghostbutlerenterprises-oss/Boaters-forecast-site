import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@12.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!stripeSecret || !webhookSecret) {
    return new Response(
      JSON.stringify({ error: 'Stripe not configured' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }

  try {
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response(
        JSON.stringify({ error: 'No signature' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const body = await req.text()
    
    // Verify webhook signature using Stripe library
    const stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' })
    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        
        // Create or update subscription
        const trialEndsAt = new Date()
        trialEndsAt.setDate(trialEndsAt.getDate() + 30)
        
        const { error } = await supabaseClient
          .from('subscriptions')
          .upsert({
            user_id: session.client_reference_id, // This should be set to the user's ID
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            status: 'trialing',
            trial_ends_at: trialEndsAt.toISOString(),
            current_period_start: new Date().toISOString(),
            current_period_end: trialEndsAt.toISOString()
          })

        if (error) throw error
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object
        
        // Update subscription to active
        const { error } = await supabaseClient
          .from('subscriptions')
          .update({
            status: 'active',
            current_period_start: new Date(invoice.period_start * 1000).toISOString(),
            current_period_end: new Date(invoice.period_end * 1000).toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('stripe_customer_id', invoice.customer)

        if (error) throw error
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        
        // Mark subscription as past_due
        const { error } = await supabaseClient
          .from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString()
          })
          .eq('stripe_customer_id', invoice.customer)

        if (error) throw error
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        
        // Mark subscription as cancelled
        const { error } = await supabaseClient
          .from('subscriptions')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('stripe_subscription_id', subscription.id)

        if (error) throw error
        break
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
