// Bootstraps the first admin if none exists. Public endpoint: only succeeds when there are zero admins.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, password, name } = await req.json();
    if (!email || !password) {
      return json({ error: "email and password required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { count, error: countErr } = await admin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) return json({ error: "Admin already exists" }, 403);

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name ?? "Admin" },
    });
    if (cErr) throw cErr;

    const userId = created.user!.id;
    // Replace default 'client' role with 'admin'
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: rErr } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "admin" });
    if (rErr) throw rErr;

    return json({ ok: true, user_id: userId });
  } catch (e) {
    console.error("bootstrap-admin error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}