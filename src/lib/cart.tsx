import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";

export interface CartItem {
  product_id: string;
  reference: string;
  description: string;
  color: string;
  size: string;
  quantity: number;
  unit_price: number;
  image_url?: string;
}

type Carts = Record<string, CartItem[]>; // brand_id -> items

interface CartCtx {
  carts: Carts;
  addItem: (brandId: string, item: CartItem) => void;
  updateQty: (brandId: string, idx: number, qty: number) => void;
  removeItem: (brandId: string, idx: number) => void;
  clearBrand: (brandId: string) => void;
  countFor: (brandId: string) => number;
  totalFor: (brandId: string) => number;
}

const Ctx = createContext<CartCtx>(null as unknown as CartCtx);
const KEY = "b2b_carts_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Carts>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setCarts(JSON.parse(raw));
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(carts));
  }, [carts]);

  const value = useMemo<CartCtx>(() => ({
    carts,
    addItem: (brandId, item) =>
      setCarts((c) => {
        const list = c[brandId] ?? [];
        // merge if same product+color+size
        const idx = list.findIndex(
          (x) => x.product_id === item.product_id && x.color === item.color && x.size === item.size,
        );
        const next = [...list];
        if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + item.quantity };
        else next.push(item);
        return { ...c, [brandId]: next };
      }),
    updateQty: (brandId, idx, qty) =>
      setCarts((c) => {
        const list = [...(c[brandId] ?? [])];
        if (!list[idx]) return c;
        list[idx] = { ...list[idx], quantity: Math.max(1, qty) };
        return { ...c, [brandId]: list };
      }),
    removeItem: (brandId, idx) =>
      setCarts((c) => {
        const list = [...(c[brandId] ?? [])];
        list.splice(idx, 1);
        return { ...c, [brandId]: list };
      }),
    clearBrand: (brandId) => setCarts((c) => ({ ...c, [brandId]: [] })),
    countFor: (brandId) =>
      (carts[brandId] ?? []).reduce((s, i) => s + i.quantity, 0),
    totalFor: (brandId) =>
      (carts[brandId] ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0),
  }), [carts]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCart = () => useContext(Ctx);

export const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });