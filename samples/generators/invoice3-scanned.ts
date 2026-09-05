/**
 * Invoice 3 — Scanned PDF simulation
 *
 * Strategy (100% Node/TS, no Python, no Ghostscript, no native canvas):
 * 1. Build a clean invoice layout by drawing into a raw RGBA pixel buffer
 * 2. Apply "scan simulation": Gaussian noise + brightness reduction + row-level skew
 * 3. Encode RGBA → PNG using our pure-TS PNG encoder (Node's built-in zlib)
 * 4. Embed the PNG as a full-page image inside a PDF via pdfkit
 *
 * Result: an image-only PDF that pdf-parse returns near-zero text for,
 * correctly triggering the scanned→vision LLM path in the ingestion service.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { encodePng } from "./png-encode.js";

const PAGE_W = 850;
const PAGE_H = 1100;

// ── RGBA pixel buffer helpers ─────────────────────────────────────────────

function makePixelBuffer(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(PAGE_W * PAGE_H * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 245; buf[i + 1] = 245; buf[i + 2] = 245; buf[i + 3] = 255;
  }
  return buf;
}

function drawRect(
  buf: Uint8ClampedArray,
  x: number, y: number, w: number, h: number,
  r: number, g: number, b: number
): void {
  for (let row = Math.max(0, y); row < Math.min(PAGE_H, y + h); row++) {
    for (let col = Math.max(0, x); col < Math.min(PAGE_W, x + w); col++) {
      const idx = (row * PAGE_W + col) * 4;
      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
    }
  }
}

function drawHLine(
  buf: Uint8ClampedArray,
  y: number, x1: number, x2: number,
  r: number, g: number, b: number, thickness = 2
): void {
  for (let t = 0; t < thickness; t++) {
    for (let col = x1; col <= x2; col++) {
      const rowY = y + t;
      if (rowY >= 0 && rowY < PAGE_H && col >= 0 && col < PAGE_W) {
        const idx = (rowY * PAGE_W + col) * 4;
        buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
      }
    }
  }
}

function drawTextBlock(
  buf: Uint8ClampedArray,
  x: number, y: number,
  width: number, lineHeight: number, lines: number,
  r = 30, g = 30, b = 30
): void {
  for (let l = 0; l < lines; l++) {
    const rowY = y + l * (lineHeight + 3);
    for (let row = rowY; row < rowY + lineHeight; row++) {
      if (row >= PAGE_H) break;
      for (let col = x; col < x + width; col++) {
        if (col >= PAGE_W) break;
        const idx = (row * PAGE_W + col) * 4;
        buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
      }
    }
  }
}

// ── Draw the invoice layout ────────────────────────────────────────────────

function drawInvoiceLayout(buf: Uint8ClampedArray): void {
  // Header bar
  drawRect(buf, 0, 0, PAGE_W, 90, 20, 40, 80);
  // Company name (white)
  drawRect(buf, 50, 15, 420, 18, 255, 255, 255);
  drawRect(buf, 50, 40, 280, 10, 200, 210, 230);
  drawRect(buf, 50, 56, 340, 8, 180, 190, 210);
  // INVOICE label
  drawRect(buf, PAGE_W - 220, 22, 160, 20, 220, 50, 50);
  drawRect(buf, PAGE_W - 180, 50, 120, 9, 255, 255, 255);
  drawRect(buf, PAGE_W - 180, 64, 100, 9, 255, 255, 255);

  // Bill To section
  drawRect(buf, 50, 110, 80, 11, 20, 40, 80);
  drawTextBlock(buf, 50, 128, 260, 9, 4, 40, 40, 40);

  // Meta table (right side)
  const metaLabels = [110, 126, 142, 158];
  metaLabels.forEach((y) => {
    drawRect(buf, 350, y, 100, 9, 120, 120, 120);
    drawRect(buf, 460, y, 120, 9, 40, 40, 40);
  });

  // Table header
  drawRect(buf, 50, 210, PAGE_W - 100, 22, 20, 40, 80);
  [50, 310, 370, 470].forEach((x) => {
    drawRect(buf, x + 4, 217, 80, 9, 255, 255, 255);
  });

  // Table rows (7)
  for (let i = 0; i < 7; i++) {
    const rowY = 232 + i * 24;
    if (i % 2 === 0) drawRect(buf, 50, rowY, PAGE_W - 100, 24, 245, 245, 245);
    drawTextBlock(buf, 54, rowY + 7, 240, 8, 1, 50, 50, 50);
    drawRect(buf, 310, rowY + 7, 40, 8, 50, 50, 50);
    drawRect(buf, 370, rowY + 7, 60, 8, 50, 50, 50);
    drawRect(buf, 470, rowY + 7, 70, 8, 50, 50, 50);
  }

  // Totals section
  const totY = 232 + 7 * 24 + 10;
  drawHLine(buf, totY - 2, 350, PAGE_W - 50, 180, 180, 180, 1);
  drawRect(buf, 350, totY, 200, 9, 100, 100, 100);
  drawRect(buf, PAGE_W - 140, totY, 90, 9, 50, 50, 50);
  drawRect(buf, 350, totY + 20, 200, 9, 100, 100, 100);
  drawRect(buf, PAGE_W - 140, totY + 20, 90, 9, 50, 50, 50);
  drawHLine(buf, totY + 34, 350, PAGE_W - 50, 150, 150, 150, 1);
  drawRect(buf, 350, totY + 38, PAGE_W - 400, 24, 20, 40, 80);
  drawRect(buf, 354, totY + 45, 130, 11, 255, 255, 255);
  drawRect(buf, PAGE_W - 140, totY + 45, 90, 11, 255, 255, 255);

  // Footer line
  drawHLine(buf, PAGE_H - 80, 50, PAGE_W - 50, 180, 180, 180, 1);
  drawTextBlock(buf, 50, PAGE_H - 65, PAGE_W - 100, 8, 2, 140, 140, 140);
}

// ── Scan simulation ────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rng: () => number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function applyScanEffect(buf: Uint8ClampedArray): void {
  const rng = mulberry32(42);
  for (let row = 0; row < PAGE_H; row++) {
    const skew = Math.floor(rng() * 3);
    for (let col = PAGE_W - 1; col >= skew; col--) {
      const srcIdx = (row * PAGE_W + (col - skew)) * 4;
      const dstIdx = (row * PAGE_W + col) * 4;
      buf[dstIdx]     = buf[srcIdx]     ?? 0;
      buf[dstIdx + 1] = buf[srcIdx + 1] ?? 0;
      buf[dstIdx + 2] = buf[srcIdx + 2] ?? 0;
    }
    for (let col = 0; col < PAGE_W; col++) {
      const idx = (row * PAGE_W + col) * 4;
      const noise = gaussianNoise(rng) * 20;
      buf[idx]     = clamp((buf[idx]     ?? 0) + noise) * 0.92;
      buf[idx + 1] = clamp((buf[idx + 1] ?? 0) + noise) * 0.92;
      buf[idx + 2] = clamp((buf[idx + 2] ?? 0) + noise) * 0.92;
    }
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export function generateInvoice3(outputPath: string): void {
  const buf = makePixelBuffer();
  drawInvoiceLayout(buf);
  applyScanEffect(buf);

  // Encode RGBA → PNG using our pure-TS encoder (uses Node's built-in zlib)
  const pngData = encodePng(buf, PAGE_W, PAGE_H);

  // Embed as a full-page image in a PDF
  const doc = new PDFDocument({ margin: 0, size: [PAGE_W, PAGE_H] });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  doc.image(pngData, 0, 0, { width: PAGE_W, height: PAGE_H });
  doc.end();

  stream.on("finish", () => {
    console.log(
      `  ✓ invoice_3_scanned.pdf written (${path.basename(outputPath)}) ` +
        `— image-only PDF, ~${Math.round(pngData.length / 1024)} KB`
    );
  });
}
