import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Eye, ArrowRight, Trash2, Monitor, Play } from "lucide-react";
import { toast } from "sonner";
import { UploadCatalogDialog } from "./UploadCatalogDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Brand {
  id: string;
  name: string;
  status: "processing" | "unpublished" | "published";
  cover_image_url: string | null;
  total_pages: number | null;
  processed_pages: number | null;
  created_at: string;
}

export default function AdminBrands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resumeBrand, setResumeBrand] = useState<{ id: string; name: string } | null>(null);
  const [newOrders, setNewOrders] = useState(0);

  const load = async () => {
    const { data } = await supabase
      .from("brands")
      .select("*")
      .order("created_at", { ascending: false });
    setBrands((data ?? []) as Brand[]);
    setLoading(false);
    const { count } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "new");
    setNewOrders(count ?? 0);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-brands")
      .on("postgres_changes", { event: "*", schema: "public", table: "brands" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const togglePublish = async (b: Brand) => {
    const next = b.status === "published" ? "unpublished" : "published";
    const { error } = await supabase.from("brands").update({ status: next }).eq("id", b.id);
    if (error) toast.error(error.message);
    else toast.success(next === "published" ? "Vitrine publicada" : "Vitrine despublicada");
  };

  const removeBrand = async (b: Brand) => {
    const { error: pErr } = await supabase.from("products").delete().eq("brand_id", b.id);
    if (pErr) return toast.error(pErr.message);
    const { error } = await supabase.from("brands").delete().eq("id", b.id);
    if (error) toast.error(error.message);
    else { toast.success("Vitrine apagada"); load(); }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-10 gap-4">
        <div>
          <p className="tracking-editorial text-muted-foreground mb-2">Painel</p>
          <h1 className="font-display text-5xl">Vitrines</h1>
        </div>
        <div className="flex items-center gap-3">
          {newOrders > 0 && (
            <Link
              to="/admin/orders"
              className="flex items-center gap-2 px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
            >
              {newOrders} novo{newOrders > 1 ? "s" : ""} pedido{newOrders > 1 ? "s" : ""}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <Button onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nova vitrine
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">carregando…</p>
      ) : brands.length === 0 ? (
        <div className="border border-dashed border-border rounded p-16 text-center">
          <p className="font-display text-2xl mb-2">Nenhuma vitrine ainda</p>
          <p className="text-muted-foreground mb-6">Suba seu primeiro catálogo PDF para começar.</p>
          <Button onClick={() => setUploadOpen(true)}>Criar vitrine</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {brands.map((b) => (
            <article key={b.id} className="bg-card border border-border rounded overflow-hidden group">
              <div className="aspect-[3/4] bg-secondary relative overflow-hidden">
                {b.cover_image_url ? (
                  <img
                    src={b.cover_image_url}
                    alt={b.name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground tracking-editorial">
                    {b.status === "processing" ? "processando…" : "sem capa"}
                  </div>
                )}
                <span className={`absolute top-3 left-3 px-2 py-0.5 text-[10px] tracking-editorial bg-background/90 ${
                  b.status === "published" ? "text-primary" : "text-muted-foreground"
                }`}>
                  {b.status === "published" ? "publicada" : b.status === "processing" ? "processando" : "rascunho"}
                </span>
              </div>
              <div className="p-4">
                <h3 className="font-display text-xl mb-1">{b.name}</h3>
                {b.status === "processing" && b.total_pages ? (
                  <p className="text-xs text-muted-foreground mb-3">
                    {b.processed_pages ?? 0} / {b.total_pages} páginas
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mb-3">
                    {new Date(b.created_at).toLocaleDateString("pt-BR")}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {b.status === "processing" && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => { setResumeBrand({ id: b.id, name: b.name }); setUploadOpen(true); }}
                      >
                        <Play className="h-3.5 w-3.5 mr-1.5" /> Continuar
                      </Button>
                    )}
                    <Link to={`/admin/brands/${b.id}`}>
                      <Button variant="outline" size="sm">
                        <Eye className="h-3.5 w-3.5 mr-1.5" /> Editar
                      </Button>
                    </Link>
                    <Link to={`/admin/brands/${b.id}/preview`}>
                      <Button variant="ghost" size="sm" aria-label="Ver como cliente">
                        <Monitor className="h-3.5 w-3.5 mr-1.5" /> Ver
                      </Button>
                    </Link>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label="Apagar vitrine">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Apagar vitrine?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação remove definitivamente a vitrine "{b.name}" e todos os seus produtos. Não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => removeBrand(b)}>Sim, apagar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Publicada
                    <Switch
                      checked={b.status === "published"}
                      onCheckedChange={() => togglePublish(b)}
                      disabled={b.status === "processing"}
                    />
                  </label>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <UploadCatalogDialog
        open={uploadOpen}
        onOpenChange={(v) => { setUploadOpen(v); if (!v) setResumeBrand(null); }}
        onCreated={load}
        resumeBrand={resumeBrand}
      />
    </div>
  );
}