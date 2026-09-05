import { describe, it, expect, afterAll } from "vitest";
import { db, client, schema } from "./index.js";
import { eq } from "drizzle-orm";

describe("Database Schema & Relations", () => {
  afterAll(async () => {
    await client.end();
  });

  it("has public tables documents, invoices, and line_items", async () => {
    const tables = await client<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public';
    `;
    const names = tables.map((t) => t.tablename);
    expect(names).toContain("documents");
    expect(names).toContain("invoices");
    expect(names).toContain("line_items");
  });

  it("persists document -> invoice -> line items and cascades deletion", async () => {
    // 1. Insert document
    const [doc] = await db
      .insert(schema.documents)
      .values({
        filename: "test-doc.pdf",
        file_type: "pdf",
        storage_path: "/storage/test-doc.pdf",
        status: "pending",
      })
      .returning();

    expect(doc).toBeDefined();
    if (!doc) return;

    // 2. Insert invoice
    const [inv] = await db
      .insert(schema.invoices)
      .values({
        document_id: doc.id,
        vendor_name: "Test Vendor Inc.",
        invoice_number: "TEST-1234",
        invoice_date: "2024-06-01",
        grand_total: 250.0,
        field_confidence: { vendor_name: "high" },
        needs_review: false,
        reviewed_by_human: false,
      })
      .returning();

    expect(inv).toBeDefined();
    if (!inv) return;

    // 3. Insert line item
    const [item] = await db
      .insert(schema.lineItems)
      .values({
        invoice_id: inv.id,
        description: "Test Consultation",
        qty: 1,
        unit_price: 250.0,
        total: 250.0,
      })
      .returning();

    expect(item).toBeDefined();
    if (!item) return;

    // 4. Cascade delete: delete document
    await db.delete(schema.documents).where(eq(schema.documents.id, doc.id));

    // Verify invoice and line items were removed by cascade
    const invCheck = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, inv.id));
    const itemCheck = await db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.id, item.id));

    expect(invCheck).toHaveLength(0);
    expect(itemCheck).toHaveLength(0);
  });
});
