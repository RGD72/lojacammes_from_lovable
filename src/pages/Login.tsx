import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email("Email inválido").max(255),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres").max(72),
});

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, role, signIn, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapName, setBootstrapName] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      // count returns 0 for clients without admin role due to RLS, but bootstrap-admin enforces server-side
      const { count } = await supabase
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if (!cancel) {
        setNeedsBootstrap((count ?? 0) === 0);
        setChecking(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (!loading && user && role) {
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from ?? (role === "admin" ? "/admin" : "/"), { replace: true });
    }
  }, [loading, user, role, nav, loc.state]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await signIn(parsed.data.email, parsed.data.password);
    setSubmitting(false);
    if (error) toast.error(error);
  };

  const onBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    if (bootstrapName.trim().length < 2) {
      toast.error("Informe seu nome");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("bootstrap-admin", {
      body: { email: parsed.data.email, password: parsed.data.password, name: bootstrapName.trim() },
    });
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Falha");
      setSubmitting(false);
      return;
    }
    toast.success("Administrador criado. Entrando…");
    await signIn(parsed.data.email, parsed.data.password);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex bg-secondary items-end p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-30 bg-gradient-to-br from-accent to-secondary" />
        <div className="relative">
          <p className="tracking-editorial text-muted-foreground mb-4">Atelier · b2b</p>
          <h1 className="font-display text-5xl xl:text-6xl text-balance leading-tight">
            A vitrine das suas marcas, em um só lugar.
          </h1>
        </div>
      </div>
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-3xl mb-1">{needsBootstrap ? "Criar administrador" : "Entrar"}</h2>
          <p className="text-sm text-muted-foreground mb-8">
            {needsBootstrap
              ? "Nenhum administrador detectado. Crie a conta inicial."
              : "Acesso restrito · use suas credenciais"}
          </p>
          <form onSubmit={needsBootstrap ? onBootstrap : onLogin} className="space-y-4">
            {needsBootstrap && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" value={bootstrapName} onChange={(e) => setBootstrapName(e.target.value)} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || checking}>
              {submitting ? "Aguarde…" : needsBootstrap ? "Criar e entrar" : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}