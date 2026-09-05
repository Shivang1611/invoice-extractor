import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../index.js";
import { client } from "../db/index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_INPUT = path.resolve(__dirname, "../../../../samples/input");

describe("API Endpoints End-to-End", () => {
  let createdDocId: string;
  let createdInvoiceId: string;

  afterAll(async () => {
    await client.end();
  });

  it("POST /documents/upload - uploads a valid invoice file", async () => {
    const filePath = path.join(SAMPLES_INPUT, "invoice_1.pdf");

    const res = await request(app)
      .post("/documents/upload")
      .attach("file", filePath);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.document).toBeDefined();
    expect(res.body.document.filename).toBe("invoice_1.pdf");
    expect(res.body.document.status).toBe("pending");

    createdDocId = res.body.document.id;
  });

  it("GET /documents - returns the uploaded documents list", async () => {
    const res = await request(app).get("/documents");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
    expect(res.body.documents.some((d: { id: string }) => d.id === createdDocId)).toBe(true);
  });

  it("POST /documents/:id/extract - runs ingestion + extraction and persists result", async () => {
    const res = await request(app).post(`/documents/${createdDocId}/extract`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invoice).toBeDefined();
    expect(res.body.invoice.vendor_name).toContain("Pinnacle Office Supplies");
    expect(res.body.invoice.document_id).toBe(createdDocId);
    expect(Array.isArray(res.body.invoice.line_items)).toBe(true);
    expect(res.body.invoice.line_items.length).toBeGreaterThan(0);

    createdInvoiceId = res.body.invoice.id;
  });

  it("GET /documents/:id - returns full document record with invoice and line items", async () => {
    const res = await request(app).get(`/documents/${createdDocId}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.document.id).toBe(createdDocId);
    expect(res.body.document.invoice).toBeDefined();
    expect(res.body.document.invoice.id).toBe(createdInvoiceId);
    expect(res.body.document.invoice.lineItems.length).toBeGreaterThan(0);
  });

  it("PATCH /invoices/:id - applies human correction and marks reviewed_by_human = true", async () => {
    const res = await request(app)
      .patch(`/invoices/${createdInvoiceId}`)
      .send({
        vendor_name: "Pinnacle Office Supplies International Inc.",
        grand_total: 820.0,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invoice.vendor_name).toBe(
      "Pinnacle Office Supplies International Inc."
    );
    expect(res.body.invoice.grand_total).toBe(820.0);
    expect(res.body.invoice.reviewed_by_human).toBe(true);
    expect(res.body.invoice.needs_review).toBe(false);
  });
});
