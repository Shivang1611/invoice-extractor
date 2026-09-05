/**
 * File Ingestion Service
 *
 * Takes a file buffer + filename and produces LLM-ready input:
 *   - text-based PDF  → { type: "text", content: string, charCount: number }
 *   - scanned PDF     → { type: "image", base64: string, mimeType: "image/png", pageIndex: 0 }
 *   - Excel (.xlsx)   → { type: "text", content: string, charCount: number }
 *   - other           → throws UnsupportedFileError
 *
 * "Scanned" detection: if the extracted text length is < TEXT_MIN_LENGTH (50 chars),
 * the PDF is assumed to be image-based and we render page 0 to PNG.
 *
 * All rendering is 100% pure TypeScript/Node.js without native dependencies
 * (no python, no ghostscript, no native canvas).
 */

import type { Buffer } from "node:buffer";
import sharp from "sharp";
import { encodePng } from "./png-encode.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextIngestionResult = {
  type: "text";
  content: string;
  /** Character count of the extracted content. */
  charCount: number;
};

export type ImageIngestionResult = {
  type: "image";
  /** PNG/JPEG/WEBP encoded as base64 — ready for vision-capable LLM input. */
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  /** Which page was rendered (0-indexed). */
  pageIndex: number;
};

export type IngestionResult = TextIngestionResult | ImageIngestionResult;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UnsupportedFileError extends Error {
  constructor(extension: string) {
    super(
      `Unsupported file type: "${extension}". Supported: .pdf, .xlsx, .xls, .png, .jpg, .jpeg, .webp`
    );
    this.name = "UnsupportedFileError";
  }
}

export class IngestionError extends Error {
  public override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "IngestionError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * If text extraction returns fewer characters than this threshold,
 * we treat the PDF as scanned / image-based.
 */
const TEXT_MIN_LENGTH = 50;

// ---------------------------------------------------------------------------
// PDF text extraction (text-based PDFs)
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Use pdfjs-dist for modern PDF xref & text stream parsing
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const u8Data = new Uint8Array(buffer.slice());
    const loadingTask = pdfjsLib.getDocument({
      data: u8Data,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const doc = await loadingTask.promise;
    let fullText = "";

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      fullText += pageText + "\n";
    }

    const trimmed = fullText.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch {
    // Fallback to pdf-parse if pdfjs-dist had an unexpected error
    try {
      const pdfParse = await import("pdf-parse/lib/pdf-parse.js");
      const fn = (pdfParse.default ?? pdfParse) as (
        data: Buffer,
        options?: Record<string, unknown>
      ) => Promise<{ text: string }>;
      const result = await fn(buffer, { max: 0 });
      return result.text.trim();
    } catch {
      // Both failed or no text found
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Affine Matrix class for Canvas 2D getTransform polyfill
// ---------------------------------------------------------------------------

class AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  invertSelf(): AffineMatrix {
    const det = this.a * this.d - this.b * this.c || 1;
    const a = this.d / det;
    const b = -this.b / det;
    const c = -this.c / det;
    const d = this.a / det;
    const e = (this.c * this.f - this.d * this.e) / det;
    const f = (this.b * this.e - this.a * this.f) / det;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Pure-TypeScript Canvas Factory for pdfjs-dist
// ---------------------------------------------------------------------------

type MinimalCanvas = {
  width: number;
  height: number;
  ctx: MinimalContext;
};

type MinimalContext = {
  canvas: MinimalCanvas;
  __rgba: Uint8ClampedArray;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type CanvasAndContext = {
  canvas: MinimalCanvas;
  context: MinimalContext;
};

function makeMinimalCanvasFactory() {
  return {
    create(w: number, h: number): CanvasAndContext {
      const width = Math.max(1, Math.ceil(w));
      const height = Math.max(1, Math.ceil(h));
      const rgba = new Uint8ClampedArray(width * height * 4);

      // Default background: white (255, 255, 255, 255)
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      }

      const canvas: MinimalCanvas = { width, height, ctx: null as unknown as MinimalContext };
      let currentTransform = new AffineMatrix();
      const transformStack: AffineMatrix[] = [];
      let fillStyle = "black";
      let strokeStyle = "black";
      let globalAlpha = 1.0;

      function parseColor(c: string): [number, number, number] {
        if (c === "black" || c === "#000000") return [0, 0, 0];
        if (c === "white" || c === "#ffffff") return [255, 255, 255];
        const hex = c.match(/^#([0-9a-f]{6})$/i);
        if (hex?.[1]) {
          const n = parseInt(hex[1], 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
        const rgb = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgb?.[1] && rgb[2] && rgb[3]) {
          return [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)];
        }
        return [0, 0, 0];
      }

      function fillPixel(x: number, y: number, r: number, g: number, b: number, a = 1.0): void {
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi < 0 || xi >= width || yi < 0 || yi >= height) return;
        const idx = (yi * width + xi) * 4;
        const alpha = a * globalAlpha;
        rgba[idx] = Math.round((rgba[idx] ?? 0) * (1 - alpha) + r * alpha);
        rgba[idx + 1] = Math.round((rgba[idx + 1] ?? 0) * (1 - alpha) + g * alpha);
        rgba[idx + 2] = Math.round((rgba[idx + 2] ?? 0) * (1 - alpha) + b * alpha);
        rgba[idx + 3] = 255;
      }

      function fillRectangleRgb(
        rx: number,
        ry: number,
        rw: number,
        rh: number,
        r: number,
        g: number,
        b: number
      ): void {
        for (let row = Math.max(0, Math.round(ry)); row < Math.min(height, Math.round(ry + rh)); row++) {
          for (let col = Math.max(0, Math.round(rx)); col < Math.min(width, Math.round(rx + rw)); col++) {
            fillPixel(col, row, r, g, b);
          }
        }
      }

      const ctx: MinimalContext = {
        canvas,
        __rgba: rgba,

        get fillStyle() { return fillStyle; },
        set fillStyle(v: string) { fillStyle = v; },
        get strokeStyle() { return strokeStyle; },
        set strokeStyle(v: string) { strokeStyle = v; },
        get globalAlpha() { return globalAlpha; },
        set globalAlpha(v: number) { globalAlpha = v; },

        font: "10px sans-serif",
        textAlign: "left",
        textBaseline: "alphabetic",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 10,
        globalCompositeOperation: "source-over",
        shadowBlur: 0,
        shadowColor: "transparent",
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        imageSmoothingEnabled: true,

        getTransform() {
          return new AffineMatrix(
            currentTransform.a,
            currentTransform.b,
            currentTransform.c,
            currentTransform.d,
            currentTransform.e,
            currentTransform.f
          );
        },
        setTransform(
          a: AffineMatrix | number,
          b?: number,
          c?: number,
          d?: number,
          e?: number,
          f?: number
        ) {
          if (typeof a === "object") {
            currentTransform = new AffineMatrix(a.a, a.b, a.c, a.d, a.e, a.f);
          } else {
            currentTransform = new AffineMatrix(a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0);
          }
        },
        transform(a: number, b: number, c: number, d: number, e: number, f: number) {
          currentTransform = new AffineMatrix(a, b, c, d, e, f);
        },
        resetTransform() {
          currentTransform = new AffineMatrix();
        },
        save() {
          transformStack.push(
            new AffineMatrix(
              currentTransform.a,
              currentTransform.b,
              currentTransform.c,
              currentTransform.d,
              currentTransform.e,
              currentTransform.f
            )
          );
        },
        restore() {
          const t = transformStack.pop();
          if (t) currentTransform = t;
        },
        scale() {},
        rotate() {},
        translate() {},

        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        bezierCurveTo() {},
        quadraticCurveTo() {},
        rect() {},
        arc() {},
        clip() {},
        stroke() {},
        fill() {},

        fillRect(rx: number, ry: number, rw: number, rh: number) {
          const [r, g, b] = parseColor(fillStyle);
          fillRectangleRgb(rx, ry, rw, rh, r, g, b);
        },
        strokeRect() {},
        clearRect(rx: number, ry: number, rw: number, rh: number) {
          fillRectangleRgb(rx, ry, rw, rh, 255, 255, 255);
        },

        fillText() {},
        strokeText() {},
        measureText() { return { width: 0 }; },

        createImageData(dw: number, dh: number) {
          return { data: new Uint8ClampedArray(dw * dh * 4), width: dw, height: dh };
        },
        putImageData(
          imgData: { data: Uint8ClampedArray; width: number; height: number },
          dx: number,
          dy: number
        ) {
          const { data, width: iw, height: ih } = imgData;
          for (let r = 0; r < ih; r++) {
            for (let c = 0; c < iw; c++) {
              const targetX = dx + c;
              const targetY = dy + r;
              if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
              const sIdx = (r * iw + c) * 4;
              const dIdx = (targetY * width + targetX) * 4;
              rgba[dIdx] = data[sIdx] ?? 0;
              rgba[dIdx + 1] = data[sIdx + 1] ?? 0;
              rgba[dIdx + 2] = data[sIdx + 2] ?? 0;
              rgba[dIdx + 3] = data[sIdx + 3] ?? 255;
            }
          }
        },
        getImageData(gx: number, gy: number, gw: number, gh: number) {
          const out = new Uint8ClampedArray(gw * gh * 4);
          for (let row = 0; row < gh; row++) {
            for (let col = 0; col < gw; col++) {
              const srcX = gx + col;
              const srcY = gy + row;
              const srcIdx = (srcY * width + srcX) * 4;
              const dstIdx = (row * gw + col) * 4;
              out[dstIdx] = srcX >= 0 && srcX < width && srcY >= 0 && srcY < height ? (rgba[srcIdx] ?? 255) : 255;
              out[dstIdx + 1] = srcX >= 0 && srcX < width && srcY >= 0 && srcY < height ? (rgba[srcIdx + 1] ?? 255) : 255;
              out[dstIdx + 2] = srcX >= 0 && srcX < width && srcY >= 0 && srcY < height ? (rgba[srcIdx + 2] ?? 255) : 255;
              out[dstIdx + 3] = 255;
            }
          }
          return { data: out, width: gw, height: gh };
        },

        createLinearGradient() {
          return { addColorStop() {} };
        },
        createRadialGradient() {
          return { addColorStop() {} };
        },
        createPattern() { return null; },

        drawImage(
          img: { ctx?: MinimalContext; __rgba?: Uint8ClampedArray; data?: Uint8ClampedArray; width?: number; height?: number }
        ) {
          const srcRgba = img.ctx?.__rgba ?? img.__rgba ?? img.data;
          if (!srcRgba || !img.width || !img.height) return;
          const srcW = img.width;
          const srcH = img.height;

          // Blit / scale into target canvas
          for (let r = 0; r < height; r++) {
            const srcRow = Math.min(srcH - 1, Math.floor((r / height) * srcH));
            for (let c = 0; c < width; c++) {
              const srcCol = Math.min(srcW - 1, Math.floor((c / width) * srcW));
              const sIdx = (srcRow * srcW + srcCol) * 4;
              const dIdx = (r * width + c) * 4;
              rgba[dIdx] = srcRgba[sIdx] ?? 255;
              rgba[dIdx + 1] = srcRgba[sIdx + 1] ?? 255;
              rgba[dIdx + 2] = srcRgba[sIdx + 2] ?? 255;
              rgba[dIdx + 3] = srcRgba[sIdx + 3] ?? 255;
            }
          }
        },

        setLineDash() {},
        getLineDash() { return []; },
        isPointInPath() { return false; },
        isPointInStroke() { return false; },
      };

      canvas.ctx = ctx;
      return { canvas, context: ctx };
    },

    reset(cAndC: CanvasAndContext, w: number, h: number): void {
      cAndC.canvas.width = Math.max(1, Math.ceil(w));
      cAndC.canvas.height = Math.max(1, Math.ceil(h));
    },

    destroy(): void {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// PDF → PNG rendering (scanned/image-based PDFs)
// ---------------------------------------------------------------------------

async function renderPdfPageToPng(
  buffer: Buffer,
  pageIndex = 0
): Promise<Buffer> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const canvasFactory = makeMinimalCanvasFactory();

  const u8Data = new Uint8Array(buffer.slice());
  const loadingTask = pdfjsLib.getDocument({
    data: u8Data,
    isEvalSupported: false,
    useSystemFonts: true,
    canvasFactory,
  } as unknown as Parameters<typeof pdfjsLib.getDocument>[0]);

  const pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs is 1-indexed

  const viewport = page.getViewport({ scale: 1.0 });
  const canvasAndCtx = canvasFactory.create(viewport.width, viewport.height);

  await page.render({
    canvasContext: canvasAndCtx.context,
    viewport,
    canvasFactory,
  } as unknown as Parameters<typeof page.render>[0]).promise;

  // Encode raw RGBA buffer into a valid PNG
  const pngBuffer = encodePng(
    canvasAndCtx.context.__rgba,
    canvasAndCtx.canvas.width,
    canvasAndCtx.canvas.height
  );

  return pngBuffer;
}

// ---------------------------------------------------------------------------
// Excel → text table
// ---------------------------------------------------------------------------

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    lines.push(`=== Sheet: ${sheetName} ===`);

    const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: true,
    });

    for (const row of aoa) {
      const cells = row.map((cell) => {
        if (cell === null || cell === undefined || cell === "") return "";
        if (cell instanceof Date) return cell.toISOString().split("T")[0] ?? "";
        if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
          return String(cell);
        }
        return JSON.stringify(cell);
      });
      lines.push(cells.join("\t"));
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

/**
 * Ingest a file buffer and return LLM-ready input.
 *
 * @param buffer   Raw file bytes
 * @param filename Original filename (used to determine file type)
 */
export async function ingestFile(
  buffer: Buffer,
  filename: string
): Promise<IngestionResult> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "xlsx" || ext === "xls") {
    const content = await extractXlsxText(buffer);
    return { type: "text", content, charCount: content.length };
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") {
    // Flatten any transparent alpha/palette pixels onto a solid white canvas (#FFFFFF)
    // to prevent vision models from interpreting transparent background as pitch black.
    try {
      const flattenedJpeg = await sharp(buffer)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 95 })
        .toBuffer();
      const base64 = flattenedJpeg.toString("base64");
      return { type: "image", base64, mimeType: "image/jpeg", pageIndex: 0 };
    } catch (sharpErr) {
      console.warn("[ingestion] sharp flatten failed, using raw buffer:", sharpErr);
      const mimeType =
        ext === "png"
          ? "image/png"
          : ext === "webp"
          ? "image/webp"
          : "image/jpeg";
      const base64 = buffer.toString("base64");
      return { type: "image", base64, mimeType, pageIndex: 0 };
    }
  }

  if (ext === "pdf") {
    const text = await extractPdfText(buffer);

    if (text.length >= TEXT_MIN_LENGTH) {
      return { type: "text", content: text, charCount: text.length };
    }

    // Text too short (< 50 chars) — route to scanned PDF image path
    console.log(`[ingestion] Low text yield (${text.length} chars) — routing to image path`);
    const pngBuffer = await renderPdfPageToPng(buffer, 0);
    const base64 = pngBuffer.toString("base64");
    return { type: "image", base64, mimeType: "image/png", pageIndex: 0 };
  }

  throw new UnsupportedFileError(`.${ext}`);
}
