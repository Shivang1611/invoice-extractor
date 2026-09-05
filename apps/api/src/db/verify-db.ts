import { db, client, schema } from "./index.js";
import { eq } from "drizzle-orm";

async function verifyDatabase() {
  console.log("\n🔍 Verifying database tables, columns, and foreign keys...\n");

  // 1. Check tables exist in pg_tables
  const tables = await client<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`;
  const tableNames = tables.map((t) => t.tablename);
  console.log("Found public tables:", tableNames);

  const requiredTables = ["documents", "invoices", "line_items"];
  for (const t of requiredTables) {
    if (!tableNames.includes(t)) {
      throw new Error(`Missing expected table: ${t}`);
    }
  }
  console.log("✓ All 3 required tables exist.");

  // 2. Check foreign key constraints
  const fks = await client<{ conname: string; contype: string }[]>`
    SELECT conname, contype 
    FROM pg_constraint 
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
  `;
  const fkNames = fks.map((f) => f.conname);
  console.log("Found foreign key constraints:", fkNames);

  const hasDocFk = fkNames.some((name) => name.includes("document_id"));
  const hasInvFk = fkNames.some((name) => name.includes("invoice_id"));

  if (!hasDocFk || !hasInvFk) {
    throw new Error("Missing required foreign key constraints");
  }
  console.log("✓ Foreign key constraints validated.");

  // 3. Test insert and cascade delete
  console.log("Testing insert and relations...");
  const [doc] = await db
    .insert(schema.documents)
    .values({
      filename: "test-invoice.pdf",
      file_type: "pdf",
      storage_path: "/tmp/test-invoice.pdf",
      status: "pending",
      raw_llm_response: { test: true },
    })
    .returning();

  if (!doc) throw new Error("Failed to insert document");
  console.log("  ✓ Inserted document:", doc.id);

  const [inv] = await db
    .insert(schema.invoices)
    .values({
      document_id: doc.id,
      vendor_name: "Test Vendor",
      invoice_number: "TEST-001",
      invoice_date: "2024-01-01",
      grand_total: 100.0,
      field_confidence: { vendor_name: "high" },
      needs_review: false,
      reviewed_by_human: false,
    })
    .returning();

  if (!inv) throw new Error("Failed to insert invoice");
  console.log("  ✓ Inserted invoice:", inv.id);

  const [item] = await db
    .insert(schema.lineItems)
    .values({
      invoice_id: inv.id,
      description: "Test Item",
      qty: 1,
      unit_price: 100.0,
      total: 100.0,
    })
    .returning();

  if (!item) throw new Error("Failed to insert line item");
  console.log("  ✓ Inserted line item:", item.id);

  // Test cascade delete
  await db.delete(schema.documents).where(eq(schema.documents.id, doc.id));
  const remainingInvoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, inv.id));
  const remainingItems = await db
    .select()
    .from(schema.lineItems)
    .where(eq(schema.lineItems.id, item.id));

  if (remainingInvoices.length !== 0 || remainingItems.length !== 0) {
    throw new Error("Cascade delete failed: related invoice or items still exist");
  }
  console.log("  ✓ Cascade delete verified: deleting document removed invoice and line items.");

  console.log("\n✅ Database verification successful!\n");
}

verifyDatabase()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Database verification failed:", err);
    await client.end();
    process.exit(1);
  });
