import { describe, it, expect } from "vitest";
import { runHeuristics } from "./heuristics.js";
import { extractInvoice } from "./extraction.js";
import type { InvoiceExtraction } from "@invoice-extractor/shared";
import type { IngestionResult } from "./ingestion.js";

describe("Heuristics Layer", () => {
  const validInvoice: InvoiceExtraction = {
    vendor_name: "Acme Supplies Ltd",
    invoice_number: "INV-9999",
    invoice_date: "2024-05-10",
    line_items: [
      { description: "Widget A", qty: 2, unit_price: 25, total: 50 },
      { description: "Widget B", qty: 1, unit_price: 50, total: 50 },
    ],
    grand_total: 100,
    confidence: {
      vendor_name: "high",
      invoice_number: "high",
      invoice_date: "high",
      line_items: "high",
      grand_total: "high",
    },
    extraction_notes: "Clean extraction.",
  };

  it("passes when all heuristics match and document is not scanned", () => {
    const res = runHeuristics(validInvoice, false);
    expect(res.needsReview).toBe(false);
    expect(res.reasons).toHaveLength(0);
    expect(res.checks.lineItemsSumMatch).toBe(true);
    expect(res.checks.validDate).toBe(true);
  });

  it("forces needsReview = true when line item sum != grand_total", () => {
    const invalidSumInvoice: InvoiceExtraction = {
      ...validInvoice,
      grand_total: 150, // Line items sum to 100, grand total is 150
    };
    const res = runHeuristics(invalidSumInvoice, false);
    expect(res.needsReview).toBe(true);
    expect(res.checks.lineItemsSumMatch).toBe(false);
    expect(res.reasons.some((r) => r.includes("Line item totals sum"))).toBe(true);
  });

  it("forces needsReview = true unconditionally for scanned images", () => {
    const res = runHeuristics(validInvoice, true);
    expect(res.needsReview).toBe(true);
    expect(res.checks.isScannedImage).toBe(true);
    expect(res.reasons.some((r) => r.includes("scanned image"))).toBe(true);
  });

  it("forces needsReview = true when date is invalid calendar date", () => {
    const invalidDateInvoice: InvoiceExtraction = {
      ...validInvoice,
      invoice_date: "2024-02-31", // Feb 31 does not exist
    };
    const res = runHeuristics(invalidDateInvoice, false);
    expect(res.needsReview).toBe(true);
    expect(res.checks.validDate).toBe(false);
    expect(res.reasons.some((r) => r.includes("not a valid calendar date"))).toBe(true);
  });

  it("forces needsReview = true when model self-reports low confidence", () => {
    const lowConfInvoice: InvoiceExtraction = {
      ...validInvoice,
      confidence: {
        ...validInvoice.confidence,
        invoice_number: "low",
      },
    };
    const res = runHeuristics(lowConfInvoice, false);
    expect(res.needsReview).toBe(true);
    expect(res.checks.hasLowConfidence).toBe(true);
    expect(res.reasons.some((r) => r.includes("low confidence"))).toBe(true);
  });
});

describe("Extraction Service", () => {
  it("extracts from text ingestion input", async () => {
    const input: IngestionResult = {
      type: "text",
      content: "PINNACLE OFFICE SUPPLIES INC. Invoice No: INV-2024-0047 Date: 2024-01-15",
      charCount: 75,
    };
    const res = await extractInvoice(input);
    expect(res.data).not.toBeNull();
    expect(res.data?.vendor_name).toContain("Pinnacle Office Supplies");
    expect(res.data?.invoice_number).toBe("INV-2024-0047");
  });

  it("extracts from image ingestion input and flags needs_review", async () => {
    const input: IngestionResult = {
      type: "image",
      base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      mimeType: "image/png",
      pageIndex: 0,
    };
    const res = await extractInvoice(input);
    expect(res.needsReview).toBe(true);
    expect(res.reviewReasons.some((r) => r.includes("scanned image"))).toBe(true);
  });
});
