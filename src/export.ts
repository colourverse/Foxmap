import { jsPDF } from 'jspdf';
import type { MindMapDoc } from './model';
import { type Measurer, buildExportSvg } from './render';

function safeName(title: string): string {
  return (title || 'mindmap').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'mindmap';
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterise the map to a canvas at the given scale. */
export async function renderToCanvas(
  doc: MindMapDoc,
  m: Measurer,
  scale: number,
  background: string,
): Promise<HTMLCanvasElement> {
  const { svg, width, height } = buildExportSvg(doc, m, background);
  // Keep the canvas within browser limits (~16k px per side, ~120M px area).
  const maxSide = 16000;
  const s = Math.min(scale, maxSide / width, maxSide / height, Math.sqrt(120e6 / (width * height)));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the map image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * s);
    canvas.height = Math.round(height * s);
    const c = canvas.getContext('2d')!;
    c.scale(s, s);
    c.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(doc: MindMapDoc, m: Measurer, transparent = false): Promise<void> {
  const canvas = await renderToCanvas(doc, m, 2, transparent ? 'transparent' : '#ffffff');
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  download(blob, safeName(doc.title) + '.png');
}

export type PdfPage = 'fit' | 'a4' | 'letter';

export async function exportPdf(doc: MindMapDoc, m: Measurer, page: PdfPage = 'a4'): Promise<void> {
  const canvas = await renderToCanvas(doc, m, 3, '#ffffff');
  const w = canvas.width;
  const h = canvas.height;
  const landscape = w >= h;
  const orientation = landscape ? 'landscape' : 'portrait';
  const img = canvas.toDataURL('image/png');

  let pdf: jsPDF;
  if (page === 'fit') {
    // Page is exactly the size of the map (1 CSS px = 0.75 pt).
    const pw = (w / 3) * 0.75;
    const ph = (h / 3) * 0.75;
    pdf = new jsPDF({ orientation, unit: 'pt', format: [pw, ph], compress: true });
    pdf.addImage(img, 'PNG', 0, 0, pw, ph);
  } else {
    pdf = new jsPDF({ orientation, unit: 'pt', format: page, compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 28;
    const k = Math.min((pw - margin * 2) / w, (ph - margin * 2) / h);
    const iw = w * k;
    const ih = h * k;
    pdf.addImage(img, 'PNG', (pw - iw) / 2, (ph - ih) / 2, iw, ih);
  }
  pdf.setProperties({ title: doc.title, creator: 'MindFox' });
  download(pdf.output('blob'), safeName(doc.title) + '.pdf');
}

export function exportJson(doc: MindMapDoc): void {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), safeName(doc.title) + '.mindfox.json');
}
