import { z } from "zod";

// ---------------------------------------------------------------------------
// Confidence levels — used for each extracted field so reviewers know
// how much the model trusted its own output.
// ---------------------------------------------------------------------------
const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

// ---------------------------------------------------------------------------
// Individual line item on an invoice
// ---------------------------------------------------------------------------
export const LineItemSchema = z.object({
  description: z.string().min(1, "Line item description must not be empty"),
  qty: z.number().finite("Quantity must be a finite number"),
  unit_price: z.number().finite("Unit price must be a finite number"),
  total: z.number().finite("Line item total must be a finite number"),
});
export type LineItem = z.infer<typeof LineItemSchema>;

// ---------------------------------------------------------------------------
// Per-field confidence map — every top-level extractable field has a rating.
// ---------------------------------------------------------------------------
export const ConfidenceMapSchema = z.object({
  vendor_name: ConfidenceLevelSchema,
  invoice_number: ConfidenceLevelSchema,
  invoice_date: ConfidenceLevelSchema,
  line_items: ConfidenceLevelSchema,
  grand_total: ConfidenceLevelSchema,
});
export type ConfidenceMap = z.infer<typeof ConfidenceMapSchema>;

// ---------------------------------------------------------------------------
// Main invoice extraction schema — the single contract between the LLM,
// the DB, and the frontend.  The LLM MUST return this shape via tool-call
// output; we never free-text parse.
// ---------------------------------------------------------------------------
export const InvoiceExtractionSchema = z.object({
  /**
   * Name of the vendor/supplier as it appears on the invoice.
   */
  vendor_name: z.string().min(1, "vendor_name must not be empty"),

  /**
   * The invoice reference / number as printed on the document.
   */
  invoice_number: z.string().min(1, "invoice_number must not be empty"),

  /**
   * ISO 8601 date string (YYYY-MM-DD).  The LLM must normalize any date
   * format it finds (e.g., "Jan 5 2024", "05/01/2024") to this form.
   */
  invoice_date: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "invoice_date must be ISO 8601 format: YYYY-MM-DD"
    ),

  /**
   * All individual line items found on the invoice, in document order.
   */
  line_items: z
    .array(LineItemSchema)
    .min(1, "At least one line item is required"),

  /**
   * The grand total (after tax, discount, etc.) as a numeric value.
   */
  grand_total: z
    .number()
    .finite("grand_total must be a finite number")
    .nonnegative("grand_total must be ≥ 0"),

  /**
   * How confident the model is in each extracted field.
   */
  confidence: ConfidenceMapSchema,

  /**
   * Free-text note from the model about anything it struggled with,
   * ambiguous fields, or data it had to infer.  Empty string if none.
   */
  extraction_notes: z.string(),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

// ---------------------------------------------------------------------------
// Partial schema for ground-truth fixtures — confidence & notes are
// human-authored so they are omitted in sample/output files.
// ---------------------------------------------------------------------------
export const GroundTruthSchema = InvoiceExtractionSchema.omit({
  confidence: true,
  extraction_notes: true,
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------
export { z };
