import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { ingestFile, UnsupportedFileError } from "./ingestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_INPUT = path.resolve(__dirname, "../../../../samples/input");

describe("Ingestion Service", () => {
  it("routes text PDF to text extraction", async () => {
    const filePath = path.join(SAMPLES_INPUT, "invoice_1.pdf");
    const buffer = fs.readFileSync(filePath);
    const result = await ingestFile(buffer, "invoice_1.pdf");

    expect(result.type).toBe("text");
    if (result.type === "text") {
      expect(result.content).toContain("PINNACLE OFFICE SUPPLIES");
      expect(result.charCount).toBeGreaterThan(100);
    }
  });

  it("routes scanned PDF to image rendering", async () => {
    const filePath = path.join(SAMPLES_INPUT, "invoice_3_scanned.pdf");
    const buffer = fs.readFileSync(filePath);
    const result = await ingestFile(buffer, "invoice_3_scanned.pdf");

    expect(result.type).toBe("image");
    if (result.type === "image") {
      expect(result.mimeType).toBe("image/png");
      expect(result.base64.length).toBeGreaterThan(1000);
      expect(result.pageIndex).toBe(0);
    }
  });

  it("routes Excel (.xlsx) to formatted text table", async () => {
    const filePath = path.join(SAMPLES_INPUT, "invoice_4.xlsx");
    const buffer = fs.readFileSync(filePath);
    const result = await ingestFile(buffer, "invoice_4.xlsx");

    expect(result.type).toBe("text");
    if (result.type === "text") {
      expect(result.content).toContain("CASCADE INDUSTRIAL HARDWARE");
      expect(result.charCount).toBeGreaterThan(100);
    }
  });

  it("routes direct image files (.png, .jpg) to image result", async () => {
    const validPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    const result = await ingestFile(validPng, "receipt.png");

    expect(result.type).toBe("image");
    if (result.type === "image") {
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.base64.length).toBeGreaterThan(0);
    }
  });

  it("throws UnsupportedFileError for invalid file extensions", async () => {
    const buffer = Buffer.from("dummy data");
    await expect(ingestFile(buffer, "invoice.docx")).rejects.toThrow(UnsupportedFileError);
  });
});
