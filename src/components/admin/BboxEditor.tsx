import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSignedUrl } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Bbox = [number, number, number, number];

export interface BboxEditorProps {
  open: boolean;
  onClose: () => void;
  productImageId: string;
  pagePath: string | null;
  initialBbox: Bbox;
  siblings: { id: string; bbox: Bbox }[];
  onSaved: (newBbox: Bbox) => void;
}

type Drag =
  | { mode: "move"; startX: number; startY: number; orig: Bbox }
  | { mode: "resize"; corner: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; orig: Bbox }
  | null;

function clampBbox(b: Bbox): Bbox {
  let [x, y, w, h] = b;
  w = Math.max(0.05, Math.min(1, w));
  h = Math.max(0.05, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return [x, y, w, h];
}

export function BboxEditor({
  open,
  onClose,
  productImageId,
  pagePath,
  initialBbox,
  siblings,
  onSaved,
}: BboxEditorProps) {
  const signed = useSignedUrl(pagePath, "catalog-pages");
  const [bbox, setBbox] = useState<Bbox>(initialBbox);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);

  useEffect(() => {
    if (open) setBbox(clampBbox(initialBbox));
  }, [open, initialBbox]);

  const toNorm = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width,
      y: (clientY - r.top) / r.height,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || !ref.current) return;
    const { x: nx, y: ny } = toNorm(e.clientX, e.clientY);
    const sx = d.startX;
    const sy = d.startY;
    const [ox, oy, ow, oh] = d.orig;
    if (d.mode === "move") {
      setBbox(clampBbox([ox + (nx - sx), oy + (ny - sy), ow, oh]));
    } else {
      let x = ox, y = oy, w = ow, h = oh;
      const dx = nx - sx;
      const dy = ny - sy;
      if (d.corner === "nw") { x = ox + dx; y = oy + dy; w = ow - dx; h = oh - dy; }
      if (d.corner === "ne") { y = oy + dy; w = ow + dx; h = oh - dy; }
      if (d.corner === "sw") { x = ox + dx; w = ow - dx; h = oh + dy; }
      if (d.corner === "se") { w = ow + dx; h = oh + dy; }
      setBbox(clampBbox([x, y, w, h]));
    }
  };

  const stopDrag = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDrag);
  };

  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const { x, y } = toNorm(e.clientX, e.clientY);
    dragRef.current = { mode: "move", startX: x, startY: y, orig: bbox };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
  };

  const startResize = (corner: "nw" | "ne" | "sw" | "se") => (e: React.PointerEvent) => {
    e.stopPropagation();
    const { x, y } = toNorm(e.clientX, e.clientY);
    dragRef.current = { mode: "resize", corner, startX: x, startY: y, orig: bbox };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
  };

  const reset = () => setBbox([0, 0, 1, 1]);

  const save = async () => {
    setSaving(true);
    const valid =
      bbox.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
      bbox[2] * bbox[3] >= 0.01 &&
      bbox[0] + bbox[2] <= 1.0001 &&
      bbox[1] + bbox[3] <= 1.0001;
    if (!valid) {
      setSaving(false);
      toast.error("Recorte inválido");
      return;
    }
    const { error } = await supabase
      .from("product_images")
      .update({ bbox: bbox as unknown as number[] })
      .eq("id", productImageId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Recorte salvo");
    onSaved(bbox);
    onClose();
  };

  const preview = useMemo(() => {
    const [x, y, w, h] = bbox;
    const scale = Math.min(1 / w, 1 / h);
    const tx = (0.5 - (x + w / 2)) * 100 * scale;
    const ty = (0.5 - (y + h / 2)) * 100 * scale;
    return { tx, ty, scale };
  }, [bbox]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Ajustar recorte</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-[2fr_1fr] gap-6">
          <div
            ref={ref}
            className="relative w-full bg-secondary rounded overflow-hidden select-none"
            style={{ aspectRatio: "3 / 4" }}
          >
            {signed ? (
              <img
                src={signed}
                alt="página do catálogo"
                draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                carregando…
              </div>
            )}
            {siblings.map((s) => {
              const [x, y, w, h] = s.bbox;
              return (
                <div
                  key={s.id}
                  className="absolute border border-muted-foreground/40 bg-muted-foreground/5 pointer-events-none"
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${h * 100}%`,
                  }}
                />
              );
            })}
            <div
              className="absolute border-2 border-primary bg-primary/10 cursor-move"
              onPointerDown={startMove}
              style={{
                left: `${bbox[0] * 100}%`,
                top: `${bbox[1] * 100}%`,
                width: `${bbox[2] * 100}%`,
                height: `${bbox[3] * 100}%`,
              }}
            >
              {(["nw", "ne", "sw", "se"] as const).map((c) => (
                <span
                  key={c}
                  onPointerDown={startResize(c)}
                  className="absolute w-3 h-3 bg-primary border border-background"
                  style={{
                    left: c.endsWith("w") ? -6 : "auto",
                    right: c.endsWith("e") ? -6 : "auto",
                    top: c.startsWith("n") ? -6 : "auto",
                    bottom: c.startsWith("s") ? -6 : "auto",
                    cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                  }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-[10px] tracking-editorial text-muted-foreground mb-1">Preview</p>
              <div className="aspect-[3/4] bg-secondary overflow-hidden rounded">
                {signed && (
                  <div className="w-full h-full overflow-hidden">
                    <img
                      src={signed}
                      alt="preview"
                      className="w-full h-full object-cover"
                      style={{
                        transform: `translate(${preview.tx}%, ${preview.ty}%) scale(${preview.scale})`,
                        transformOrigin: "center center",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>x: {(bbox[0] * 100).toFixed(1)}%</p>
              <p>y: {(bbox[1] * 100).toFixed(1)}%</p>
              <p>w: {(bbox[2] * 100).toFixed(1)}%</p>
              <p>h: {(bbox[3] * 100).toFixed(1)}%</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
              <Button variant="outline" onClick={reset} disabled={saving}>
                Resetar para página inteira
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}