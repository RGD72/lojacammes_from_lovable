// Admin-only: create a new client (or admin) account with email/password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData.user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!roles?.some((r) => r.role === "admin")) {
      return json({ error: "Forbidden" }, 403);
    }

    const { email, password, name, phone = "", role = "client", active = true } = await req.json();
    if (!email || !password || !name) {
      return json({ error: "email, password and name required" }, 400);
    }
    if (role !== "client" && role !== "admin") {
      return json({ error: "invalid role" }, 400);
    }

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (cErr) throw cErr;
    const newId = created.user!.id;

    // Update profile with name+phone+active (trigger created the row)
    await admin.from("profiles").update({ name, phone, active }).eq("id", newId);

    if (role === "admin") {
      await admin.from("user_roles").delete().eq("user_id", newId);
      await admin.from("user_roles").insert({ user_id: newId, role: "admin" });
    }

    return json({ ok: true, user_id: newId });
  } catch (e) {
    console.error("admin-create-user error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}