import * as pdfjsLib from "pdfjs-dist";
// Use Vite worker import — pdfjs ships an ES module worker
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function renderPdfPages(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<{
  totalPages: number;
  pageImageBase64: (n: number) => Promise<string>;
  pageImageBlob: (n: number) => Promise<Blob>;
}> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const totalPages = doc.numPages;

  // Reduce scale for very large PDFs to keep memory under control
  // < 50 MB → 1.5, 50-150 MB → 1.2, > 150 MB → 1.0
  const mb = file.size / (1024 * 1024);
  const scale = mb > 150 ? 1.0 : mb > 50 ? 1.2 : 1.5;

  const renderPage = async (n: number, asBase64: boolean) => {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    // Release page from memory immediately
    page.cleanup && (await page.cleanup());

    let result: string | Blob;
    if (asBase64) {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      result = dataUrl.split(",")[1];
    } else {
      result = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.85,
        );
      });
    }

    // Clean canvas to free GPU/RAM
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;

    onProgress?.(n, totalPages);
    return result;
  };

  const pageImageBase64 = async (n: number): Promise<string> => {
    return (await renderPage(n, true)) as string;
  };

  const pageImageBlob = async (n: number): Promise<Blob> => {
    return (await renderPage(n, false)) as Blob;
  };

  return { totalPages, pageImageBase64, pageImageBlob };
}
