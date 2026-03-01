import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Method check
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Extract and verify JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse and validate body
    let body: { delta?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const delta = body.delta;
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta < 1 || delta > 10) {
      return new Response(
        JSON.stringify({ error: "delta must be an integer between 1 and 10" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch profile for daily_quota
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("daily_quota")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compute today's date (UTC)
    const dayISO = new Date().toISOString().slice(0, 10);

    // Fetch current usage for today
    const { data: usage } = await supabase
      .from("daily_usage")
      .select("used")
      .eq("user_id", user.id)
      .eq("day_iso", dayISO)
      .single();

    const currentUsed = usage?.used ?? 0;

    // Check quota
    if (currentUsed + delta > profile.daily_quota) {
      return new Response(
        JSON.stringify({
          allowed: false,
          usedToday: currentUsed,
          dailyQuota: profile.daily_quota,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Upsert daily_usage
    const newUsed = currentUsed + delta;
    const { error: upsertError } = await supabase
      .from("daily_usage")
      .upsert(
        {
          user_id: user.id,
          day_iso: dayISO,
          used: newUsed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,day_iso" }
      );

    if (upsertError) {
      return new Response(JSON.stringify({ error: "Failed to update usage" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        allowed: true,
        usedToday: newUsed,
        dailyQuota: profile.daily_quota,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
