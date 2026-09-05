import { Router, type Request, type Response } from "express";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: Router = Router();

const UpdateInvoiceSchema = z.object({
  vendor_name: z.string().min(1).optional(),
  invoice_number: z.string().min(1).optional(),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "invoice_date must be YYYY-MM-DD")
    .optional(),
  grand_total: z.number().nonnegative().optional(),
  line_items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        description: z.string().min(1),
        qty: z.number(),
        unit_price: z.number(),
        total: z.number(),
      })
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// PATCH /invoices/:id
// ---------------------------------------------------------------------------
router.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Invoice ID is required" });
    return;
  }

  try {
    const parseResult = UpdateInvoiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Validation failed",
        issues: parseResult.error.issues,
      });
      return;
    }

    const updates = parseResult.data;

    const [existing] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, id));

    if (!existing) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Update invoice record
    const [updatedInvoice] = await db
      .update(schema.invoices)
      .set({
        ...(updates.vendor_name ? { vendor_name: updates.vendor_name } : {}),
        ...(updates.invoice_number
          ? { invoice_number: updates.invoice_number }
          : {}),
        ...(updates.invoice_date ? { invoice_date: updates.invoice_date } : {}),
        ...(updates.grand_total !== undefined
          ? { grand_total: updates.grand_total }
          : {}),
        reviewed_by_human: true,
        needs_review: false,
        updated_at: new Date(),
      })
      .where(eq(schema.invoices.id, id))
      .returning();

    // If line items were provided, update them
    if (updates.line_items) {
      await db
        .delete(schema.lineItems)
        .where(eq(schema.lineItems.invoice_id, id));

      if (updates.line_items.length > 0) {
        await db.insert(schema.lineItems).values(
          updates.line_items.map((item) => ({
            invoice_id: id,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            total: item.total,
          }))
        );
      }
    }

    // Also update parent document status to "extracted" if it was "needs_review"
    await db
      .update(schema.documents)
      .set({ status: "extracted" })
      .where(eq(schema.documents.id, existing.document_id));

    // Fetch updated line items
    const lineItems = await db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.invoice_id, id));

    res.json({
      ok: true,
      invoice: {
        ...updatedInvoice,
        line_items: lineItems,
      },
    });
  } catch (err) {
    console.error(`[PATCH /invoices/${id}] Error:`, err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to update invoice",
    });
  }
});

export default router;
