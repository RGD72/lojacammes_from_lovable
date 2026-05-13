import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { renderPdfPages } from "@/lib/pdf";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const MAX_BYTES = 400 * 1024 * 1024;

export function UploadCatalogDialog({
  open,
  onOpenChange,
  onCreated,
  resumeBrand,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  resumeBrand?: { id: string; name: string } | null;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const cancelRef = useRef(false);
  const brandIdRef = useRef<string | null>(null);
  const pdfPathRef = useRef<string | null>(null);
  const isResume = !!resumeBrand;

  useEffect(() => {
    if (resumeBrand) setName(resumeBrand.name);
  }, [resumeBrand]);

  // Warn user if they try to close the tab during processing
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  const reset = () => {
    setName(""); setFile(null); setBusy(false); setProgress(0); setStage("");
    cancelRef.current = false;
    brandIdRef.current = null;
    pdfPathRef.current = null;
  };

  const cleanup = async () => {
    // In resume mode never delete the brand or its existing pages/PDF.
    if (isResume) return;
    try {
      if (pdfPathRef.current) {
        await supabase.storage.from("catalogs").remove([pdfPathRef.current]);
      }
      if (brandIdRef.current) {
        // remove rendered pages folder
        const { data: list } = await supabase.storage
          .from("catalog-pages")
          .list(brandIdRef.current);
        if (list && list.length) {
          await supabase.storage
            .from("catalog-pages")
            .remove(list.map((f) => `${brandIdRef.current}/${f.name}`));
        }
        await supabase.from("products").delete().eq("brand_id", brandIdRef.current);
        await supabase.from("brands").delete().eq("id", brandIdRef.current);
      }
    } catch (err) {
      console.error("cleanup error", err);
    }
  };

  const handleCancel = async () => {
    cancelRef.current = true;
    setStage("Cancelando…");
    await cleanup();
    toast.info("Processamento cancelado");
    onCreated();
    onOpenChange(false);
    reset();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isResume && !name.trim()) return toast.error("Informe o nome da marca");
    if (!file) return toast.error("Selecione um PDF");
    if (file.size > MAX_BYTES) return toast.error("PDF acima de 400MB");
    if (!file.name.toLowerCase().endsWith(".pdf")) return toast.error("Arquivo precisa ser PDF");

    setBusy(true);
    try {
      let brand: { id: string };
      if (isResume && resumeBrand) {
        brand = { id: resumeBrand.id };
        await supabase.from("brands").update({ status: "processing" }).eq("id", brand.id);
      } else {
        setStage("Criando vitrine…");
        const { data: created, error: bErr } = await supabase
          .from("brands")
          .insert({ name: name.trim(), status: "processing" })
          .select()
          .single();
        if (bErr || !created) throw bErr ?? new Error("erro ao criar marca");
        brand = created;
        brandIdRef.current = brand.id;
      }
      if (cancelRef.current) throw new Error("__cancelled__");

      if (!isResume) {
        setStage("Enviando PDF…");
        const safeName = file.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9._-]+/g, "_")
          .replace(/_+/g, "_");
        const pdfPath = `${brand.id}/${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("catalogs")
          .upload(pdfPath, file, { contentType: "application/pdf", upsert: true });
        if (upErr) throw upErr;
        pdfPathRef.current = pdfPath;
        if (cancelRef.current) throw new Error("__cancelled__");
        const { data: pub } = supabase.storage.from("catalogs").getPublicUrl(pdfPath);
        await supabase.from("brands").update({ catalog_pdf_url: pub.publicUrl }).eq("id", brand.id);
      }

      setStage("Renderizando páginas…");
      const { totalPages, pageImageBlob } = await renderPdfPages(file);
      if (cancelRef.current) throw new Error("__cancelled__");
      await supabase.from("brands").update({ total_pages: totalPages }).eq("id", brand.id);

      // In resume mode, skip pages that already have products in DB.
      let alreadyDone = new Set<number>();
      if (isResume) {
        const { data: existing } = await supabase
          .from("products")
          .select("page_number")
          .eq("brand_id", brand.id);
        alreadyDone = new Set((existing ?? []).map((r) => r.page_number));
      }

      // Process pages sequentially to respect rate limits
      const pageResults: { page: number; products: number; error?: string }[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if (cancelRef.current) throw new Error("__cancelled__");
        if (alreadyDone.has(p)) {
          setProgress(Math.round((p / totalPages) * 100));
          continue;
        }
        setStage(`Analisando página ${p}/${totalPages}…`);
        setProgress(Math.round(((p - 1) / totalPages) * 100));
        const blob = await pageImageBlob(p);
        const pagePath = `${brand.id}/page-${String(p).padStart(4, "0")}.jpg`;
        const { error: pUpErr } = await supabase.storage
          .from("catalog-pages")
          .upload(pagePath, blob, { contentType: "image/jpeg", upsert: true });
        if (pUpErr) {
          toast.error(`Página ${p}: falha ao enviar imagem`);
          pageResults.push({ page: p, products: 0, error: "upload" });
          continue;
        }
        const { data: pPub } = supabase.storage.from("catalog-pages").getPublicUrl(pagePath);
        let lastErr: string | undefined;
        let inserted = 0;
        let updated = 0;
        // Retry up to 2 times on failure or zero products to mitigate transient AI hiccups
        for (let attempt = 1; attempt <= 2; attempt++) {
          const { data, error } = await supabase.functions.invoke("process-catalog-page", {
            body: {
              brand_id: brand.id,
              page_number: p,
              page_url: pPub.publicUrl,
              page_path: pagePath,
              total_pages: totalPages,
              is_first: p === 1,
            },
          });
          const payload = data as { error?: string; inserted?: number; updated?: number } | null;
          if (error || payload?.error) {
            lastErr = payload?.error ?? error?.message ?? "Erro IA";
            continue;
          }
          inserted = payload?.inserted ?? 0;
          updated = payload?.updated ?? 0;
          lastErr = undefined;
          if (inserted + updated > 0) break;
        }
        if (lastErr) toast.error(`Página ${p}: ${lastErr}`);
        pageResults.push({ page: p, products: inserted + updated, error: lastErr });
      }
      setProgress(100);
      // Final verification: check DB for missing pages and products without image
      setStage("Conferindo importação…");
      const { data: dbProducts } = await supabase
        .from("products")
        .select("page_number, reference, image_url, image_urls")
        .eq("brand_id", brand.id);
      const pagesWithProducts = new Set((dbProducts ?? []).map((r) => r.page_number));
      const missingPages: number[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if (!pagesWithProducts.has(p)) missingPages.push(p);
      }
      const missingImages = (dbProducts ?? []).filter(
        (r) => !r.image_url && (!Array.isArray(r.image_urls) || r.image_urls.length === 0),
      );
      if (missingPages.length === 0 && missingImages.length === 0) {
        setStage("Concluído");
        toast.success(`Catálogo processado: ${dbProducts?.length ?? 0} produtos em ${totalPages} páginas.`);
      } else {
        setStage("Concluído com avisos");
        if (missingPages.length > 0) {
          toast.warning(
            `Páginas sem produtos detectados: ${missingPages.join(", ")}. Reimporte ou edite manualmente.`,
            { duration: 10000 },
          );
        }
        if (missingImages.length > 0) {
          toast.warning(
            `${missingImages.length} produto(s) sem imagem. Verifique referências: ${missingImages
              .map((r) => r.reference)
              .filter(Boolean)
              .slice(0, 10)
              .join(", ")}`,
            { duration: 10000 },
          );
        }
      }
      onCreated();
      onOpenChange(false);
      reset();
    } catch (e) {
      if (e instanceof Error && e.message === "__cancelled__") {
        await cleanup();
        toast.info("Processamento cancelado");
        onCreated();
        onOpenChange(false);
        reset();
      } else {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Falha ao processar catálogo");
        // Clean up orphan brand so it doesn't stay stuck in "processing"
        await cleanup();
        onCreated();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Nova vitrine</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Nome da marca</Label>
            <Input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pdf">Catálogo (PDF, até 400MB)</Label>
            <Input
              id="pdf"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              required
            />
          </div>
          {busy && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">{stage}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy ? "Processando…" : "Processar catálogo"}
            </Button>
            {busy && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={cancelRef.current}>
                    Cancelar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar processamento?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O upload e os dados parciais desta vitrine serão descartados. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Continuar processando</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancel}>Sim, cancelar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}