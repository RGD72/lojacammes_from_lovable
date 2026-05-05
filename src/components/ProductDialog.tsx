import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCart, money } from "@/lib/cart";
import { toast } from "sonner";

interface Product {
  id: string; brand_id: string; reference: string; description: string;
  material: string; colors: string[]; sizes: string[]; price: number; image_url: string | null;
  image_urls?: string[] | null;
}

export function ProductDialog({
  product, brandId, onClose,
}: { product: Product | null; brandId: string; onClose: () => void }) {
  const { addItem } = useCart();
  const [color, setColor] = useState<string>("");
  const [size, setSize] = useState<string>("");
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (product) {
      setColor(product.colors.length === 1 ? product.colors[0] : "");
      setSize("");
      setQty(1);
    }
  }, [product]);

  if (!product) return null;

  const submit = () => {
    if (product.colors.length > 0 && !color) return toast.error("Escolha uma cor");
    if (product.sizes.length > 0 && !size) return toast.error("Escolha um tamanho");
    if (qty < 1) return toast.error("Quantidade inválida");
    addItem(brandId, {
      product_id: product.id,
      reference: product.reference,
      description: product.description,
      color, size, quantity: qty,
      unit_price: Number(product.price),
      image_url: product.image_url ?? undefined,
    });
    toast.success("Adicionado ao pedido");
    onClose();
  };

  return (
    <Dialog open={!!product} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">{product.description || "Produto"}</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-6">
          <DialogGallery product={product} />
          <div className="space-y-4">
            <div>
              <p className="text-[10px] tracking-editorial text-muted-foreground">Referência</p>
              <p>{product.reference || "—"}</p>
            </div>
            {product.material && (
              <div>
                <p className="text-[10px] tracking-editorial text-muted-foreground">Material</p>
                <p>{product.material}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] tracking-editorial text-muted-foreground">Preço</p>
              <p className="text-2xl font-display">{money(Number(product.price))}</p>
            </div>

            {product.colors.length > 1 && (
              <div>
                <p className="text-[10px] tracking-editorial text-muted-foreground mb-2">Cor</p>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`px-3 py-1.5 rounded border text-sm ${
                        color === c ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >{c}</button>
                  ))}
                </div>
              </div>
            )}

            {product.sizes.length > 0 && (
              <div>
                <p className="text-[10px] tracking-editorial text-muted-foreground mb-2">Tamanho</p>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSize(s)}
                      className={`px-3 py-1.5 rounded border text-sm min-w-12 ${
                        size === s ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] tracking-editorial text-muted-foreground mb-2">Quantidade</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Button>
                <span className="min-w-10 text-center">{qty}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setQty((q) => q + 1)}>+</Button>
              </div>
            </div>

            <Button onClick={submit} className="w-full">Escolhido</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}