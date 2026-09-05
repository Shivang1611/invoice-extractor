import { describe, it, expect } from "vitest";
import { InvoiceExtractionSchema } from "../src/index.js";

// ---------------------------------------------------------------------------
// Test 1 — A fully valid payload must pass parsing without errors
// ---------------------------------------------------------------------------
describe("InvoiceExtractionSchema", () => {
  it("accepts a fully valid invoice extraction payload", () => {
    const validPayload = {
      vendor_name: "Acme Supplies Ltd.",
      invoice_number: "INV-2024-001",
      invoice_date: "2024-01-15",
      line_items: [
        {
          description: "Industrial Widgets (pack of 100)",
          qty: 2,
          unit_price: 49.99,
          total: 99.98,
        },
        {
          description: "Shipping & Handling",
          qty: 1,
          unit_price: 12.5,
          total: 12.5,
        },
      ],
      grand_total: 112.48,
      confidence: {
        vendor_name: "high",
        invoice_number: "high",
        invoice_date: "medium",
        line_items: "high",
        grand_total: "high",
      },
      extraction_notes:
        "Invoice date was printed as '15 Jan 2024' and normalized to ISO format.",
    };

    const result = InvoiceExtractionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);

    if (result.success) {
      // Spot-check a few typed values to confirm inference is correct
      expect(result.data.vendor_name).toBe("Acme Supplies Ltd.");
      expect(result.data.line_items).toHaveLength(2);
      expect(result.data.grand_total).toBe(112.48);
      expect(result.data.confidence.invoice_date).toBe("medium");
    }
  });

  // -------------------------------------------------------------------------
  // Test 2 — A payload missing `invoice_number` must fail validation
  // -------------------------------------------------------------------------
  it("rejects a payload with a missing required field (invoice_number)", () => {
    const malformedPayload = {
      vendor_name: "Global Parts Co.",
      // invoice_number intentionally omitted
      invoice_date: "2024-03-10",
      line_items: [
        { description: "Bolt M8", qty: 50, unit_price: 0.15, total: 7.5 },
      ],
      grand_total: 7.5,
      confidence: {
        vendor_name: "high",
        invoice_number: "low",
        invoice_date: "high",
        line_items: "high",
        grand_total: "high",
      },
      extraction_notes: "",
    };

    const result = InvoiceExtractionSchema.safeParse(malformedPayload);
    expect(result.success).toBe(false);

    if (!result.success) {
      const missingField = result.error.issues.find((issue) =>
        issue.path.includes("invoice_number")
      );
      expect(missingField).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Test 3 — invoice_date must be in YYYY-MM-DD format; other formats fail
  // -------------------------------------------------------------------------
  it("rejects non-ISO invoice_date formats", () => {
    const payload = {
      vendor_name: "Test Corp",
      invoice_number: "T-001",
      invoice_date: "Jan 5 2024", // not ISO format
      line_items: [{ description: "Item", qty: 1, unit_price: 10, total: 10 }],
      grand_total: 10,
      confidence: {
        vendor_name: "high",
        invoice_number: "high",
        invoice_date: "low",
        line_items: "high",
        grand_total: "high",
      },
      extraction_notes: "",
    };

    const result = InvoiceExtractionSchema.safeParse(payload);
    expect(result.success).toBe(false);

    if (!result.success) {
      const dateIssue = result.error.issues.find((i) =>
        i.path.includes("invoice_date")
      );
      expect(dateIssue).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Test 4 — confidence values must be exactly "high" | "medium" | "low"
  // -------------------------------------------------------------------------
  it("rejects invalid confidence level values", () => {
    const payload = {
      vendor_name: "Test Corp",
      invoice_number: "T-002",
      invoice_date: "2024-01-05",
      line_items: [{ description: "Item", qty: 1, unit_price: 10, total: 10 }],
      grand_total: 10,
      confidence: {
        vendor_name: "very high", // invalid enum value
        invoice_number: "high",
        invoice_date: "high",
        line_items: "high",
        grand_total: "high",
      },
      extraction_notes: "",
    };

    const result = InvoiceExtractionSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
