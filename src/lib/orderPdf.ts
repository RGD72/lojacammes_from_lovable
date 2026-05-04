import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CartItem } from "@/lib/cart";

const money = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function generateOrderPdf(opts: {
  orderId: string;
  brandName: string;
  clientName: string;
  createdAt: string;
  items: CartItem[];
  total: number;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(20);
  doc.text("Pedido", 40, 50);
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text(opts.brandName, 40, 70);
  doc.setTextColor(0);

  doc.setFontSize(10);
  doc.text(`Cliente: ${opts.clientName}`, 40, 100);
  doc.text(`Data: ${new Date(opts.createdAt).toLocaleString("pt-BR")}`, 40, 115);
  doc.text(`Pedido: ${opts.orderId.slice(0, 8)}`, 40, 130);

  autoTable(doc, {
    startY: 150,
    head: [["Ref.", "Descrição", "Cor", "Tam", "Qtd", "Unit.", "Total"]],
    body: opts.items.map((i) => [
      i.reference,
      i.description,
      i.color,
      i.size,
      i.quantity,
      money(i.unit_price),
      money(i.unit_price * i.quantity),
    ]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [240, 235, 227], textColor: 40 },
    columnStyles: {
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
  });

  // @ts-expect-error autotable adds lastAutoTable
  const endY = doc.lastAutoTable?.finalY ?? 200;
  doc.setFontSize(12);
  doc.text(`Total: ${money(opts.total)}`, pageW - 40, endY + 30, { align: "right" });

  doc.save(`pedido-${opts.brandName.toLowerCase().replace(/\s+/g, "-")}-${opts.orderId.slice(0, 8)}.pdf`);
}