import * as pdfjsLib from "pdfjs-dist";
// Use Vite worker import — pdfjs ships an ES module worker
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function renderPdfPages(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<{ totalPages: number; pageImageBase64: (n: number) => Promise<string> }> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const totalPages = doc.numPages;

  const pageImageBase64 = async (n: number): Promise<string> => {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onProgress?.(n, totalPages);
    return dataUrl.split(",")[1];
  };

  return { totalPages, pageImageBase64 };
}