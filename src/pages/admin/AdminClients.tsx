import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, KeyRound, Trash2 } from "lucide-react";

interface Client { id: string; email: string; name: string; active: boolean; created_at: string; }

export default function AdminClients() {
  const [list, setList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pwUserId, setPwUserId] = useState<string | null>(null);

  const load = async () => {
    // List only client role
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const clientIds = (roles ?? []).filter((r) => r.role === "client").map((r) => r.user_id);
    if (clientIds.length === 0) { setList([]); setLoading(false); return; }
    const { data } = await supabase.from("profiles").select("*").in("id", clientIds).order("created_at", { ascending: false });
    setList((data ?? []) as Client[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (c: Client, v: boolean) => {
    const { error } = await supabase.functions.invoke("admin-update-user", {
      body: { user_id: c.id, action: "update", active: v },
    });
    if (error) toast.error(error.message);
    else { toast.success(v ? "Ativado" : "Desativado"); load(); }
  };

  const remove = async (c: Client) => {
    if (!confirm(`Excluir ${c.email}?`)) return;
    const { error } = await supabase.functions.invoke("admin-update-user", {
      body: { user_id: c.id, action: "delete" },
    });
    if (error) toast.error(error.message);
    else { toast.success("Cliente removido"); load(); }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="tracking-editorial text-muted-foreground mb-2">Painel</p>
          <h1 className="font-display text-5xl">Clientes</h1>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" />Novo cliente</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">carregando…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">Nenhum cliente cadastrado.</p>
      ) : (
        <div className="bg-card border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60">
              <tr className="text-left">
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Nome</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Email</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Cadastro</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Ativo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3">{c.name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-3"><Switch checked={c.active} onCheckedChange={(v) => toggleActive(c, v)} /></td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setPwUserId(c.id)}><KeyRound className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewClientDialog open={open} onOpenChange={setOpen} onCreated={load} />
      <PasswordDialog userId={pwUserId} onClose={() => setPwUserId(null)} />
    </div>
  );
}

function NewClientDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Senha precisa ter ao menos 6 caracteres");
    setBusy(true);
    const { error, data } = await supabase.functions.invoke("admin-create-user", {
      body: { name, email, password, role: "client", active: true },
    });
    setBusy(false);
    const errMsg = (data as { error?: string })?.error ?? error?.message;
    if (errMsg) return toast.error(errMsg);
    toast.success("Cliente criado");
    setName(""); setEmail(""); setPassword("");
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Novo cliente</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Senha inicial</Label><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Criando…" : "Criar cliente"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (pw.length < 6) return toast.error("Mínimo 6 caracteres");
    setBusy(true);
    const { error, data } = await supabase.functions.invoke("admin-update-user", {
      body: { user_id: userId, action: "update", password: pw },
    });
    setBusy(false);
    const m = (data as { error?: string })?.error ?? error?.message;
    if (m) return toast.error(m);
    toast.success("Senha atualizada");
    setPw(""); onClose();
  };
  return (
    <Dialog open={!!userId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Nova senha</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} placeholder="nova senha" />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}