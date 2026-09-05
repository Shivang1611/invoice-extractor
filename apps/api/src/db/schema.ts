import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Documents Table
// ---------------------------------------------------------------------------
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  file_type: text("file_type").notNull(),
  storage_path: text("storage_path").notNull(),
  status: text("status").notNull().default("pending"),
  raw_llm_response: jsonb("raw_llm_response"),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// Invoices Table
// ---------------------------------------------------------------------------
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  document_id: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  vendor_name: text("vendor_name").notNull(),
  invoice_number: text("invoice_number").notNull(),
  invoice_date: text("invoice_date").notNull(),
  grand_total: doublePrecision("grand_total").notNull(),
  field_confidence: jsonb("field_confidence").notNull(),
  needs_review: boolean("needs_review").notNull().default(false),
  reviewed_by_human: boolean("reviewed_by_human").notNull().default(false),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// Line Items Table
// ---------------------------------------------------------------------------
export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoice_id: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  qty: doublePrecision("qty").notNull(),
  unit_price: doublePrecision("unit_price").notNull(),
  total: doublePrecision("total").notNull(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const documentsRelations = relations(documents, ({ one }) => ({
  invoice: one(invoices, {
    fields: [documents.id],
    references: [invoices.document_id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  document: one(documents, {
    fields: [invoices.document_id],
    references: [documents.id],
  }),
  lineItems: many(lineItems),
}));

export const lineItemsRelations = relations(lineItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [lineItems.invoice_id],
    references: [invoices.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred TypeScript Types
// ---------------------------------------------------------------------------
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoiceRow = typeof invoices.$inferInsert;

export type LineItemRow = typeof lineItems.$inferSelect;
export type NewLineItemRow = typeof lineItems.$inferInsert;
