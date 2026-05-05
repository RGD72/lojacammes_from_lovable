// Admin-only: update user password / active flag / name, or delete user.
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
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!roles?.some((r) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const { user_id, action } = body;
    if (!user_id) return json({ error: "user_id required" }, 400);

    if (action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "update") {
      const { name, active, password, phone } = body;
      const upd: Record<string, unknown> = {};
      if (typeof name === "string") upd.name = name;
      if (typeof active === "boolean") upd.active = active;
      if (typeof phone === "string") upd.phone = phone;
      if (Object.keys(upd).length > 0) {
        await admin.from("profiles").update(upd).eq("id", user_id);
      }
      if (typeof password === "string" && password.length >= 6) {
        const { error } = await admin.auth.admin.updateUserById(user_id, { password });
        if (error) throw error;
      }
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("admin-update-user error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}