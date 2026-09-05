import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, schema } from "../db/index.js";
import { eq, desc } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { ingestFile } from "../services/ingestion.js";
import { extractInvoice } from "../services/extraction.js";

const router: Router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB limit
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".pdf", ".xlsx", ".xls", ".png", ".jpg", ".jpeg", ".webp"];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type: "${ext}". Supported: ${allowed.join(", ")}`
        )
      );
    }
  },
});

// Helper to split a PDF buffer into separate 1-page PDF buffers
async function splitPdfBuffer(buffer: Buffer): Promise<Buffer[]> {
  const pdfDoc = await PDFDocument.load(buffer);
  const count = pdfDoc.getPageCount();
  if (count <= 1) return [buffer];

  const results: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const subDoc = await PDFDocument.create();
    const [copiedPage] = await subDoc.copyPages(pdfDoc, [i]);
    subDoc.addPage(copiedPage);
    const subBytes = await subDoc.save();
    results.push(Buffer.from(subBytes));
  }
  return results;
}

// ---------------------------------------------------------------------------
// POST /documents/upload
// ---------------------------------------------------------------------------
router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded. Use field 'file'." });
        return;
      }

      const file = req.file;
      const ext = path.extname(file.originalname).toLowerCase().replace(".", "");

      // If multi-page PDF: split each page into a standalone document
      if (ext === "pdf") {
        try {
          const fileBuffer = fs.readFileSync(file.path);
          const pageBuffers = await splitPdfBuffer(fileBuffer);

          if (pageBuffers.length > 1) {
            const baseName = path.basename(file.originalname, path.extname(file.originalname));
            const createdDocs = [];

            for (const [i, pageBuf] of pageBuffers.entries()) {
              const pageFilename = `${baseName} (Page ${i + 1} of ${pageBuffers.length}).pdf`;
              const pageStoragePath = path.join(
                path.dirname(file.path),
                `${path.basename(file.path, ".pdf")}_page_${i + 1}.pdf`
              );
              fs.writeFileSync(pageStoragePath, pageBuf);

              const [newDoc] = await db
                .insert(schema.documents)
                .values({
                  filename: pageFilename,
                  file_type: "pdf",
                  storage_path: pageStoragePath,
                  status: "pending",
                })
                .returning();

              if (newDoc) {
                createdDocs.push(newDoc);
              }
            }

            // Remove original un-split bundle file
            try {
              fs.unlinkSync(file.path);
            } catch {
              // ignore
            }

            res.status(201).json({
              ok: true,
              document: createdDocs[0],
              documents: createdDocs,
              splitPages: true,
              pageCount: pageBuffers.length,
            });
            return;
          }
        } catch (pdfErr) {
          console.warn("[upload] PDF split check skipped:", pdfErr);
        }
      }

      const [newDoc] = await db
        .insert(schema.documents)
        .values({
          filename: file.originalname,
          file_type: ext,
          storage_path: file.path,
          status: "pending",
        })
        .returning();

      res.status(201).json({
        ok: true,
        document: newDoc,
        documents: [newDoc],
      });
    } catch (err) {
      console.error("[POST /documents/upload] Error:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /documents/:id/extract
// ---------------------------------------------------------------------------
router.post("/:id/extract", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Document ID is required" });
    return;
  }

  try {
    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (!fs.existsSync(doc.storage_path)) {
      res.status(404).json({ error: "Stored file not found on disk" });
      return;
    }

    // Set status to processing
    await db
      .update(schema.documents)
      .set({ status: "processing" })
      .where(eq(schema.documents.id, id));

    let activeBuffer: Buffer = Buffer.from(fs.readFileSync(doc.storage_path));

    // If an existing document was uploaded before auto-splitting and has multiple pages:
    if (doc.file_type === "pdf" && !doc.filename.includes(" (Page ")) {
      try {
        const pageBuffers = await splitPdfBuffer(activeBuffer);
        const page1Buf = pageBuffers[0];
        if (pageBuffers.length > 1 && page1Buf) {
          const baseName = path.basename(doc.filename, path.extname(doc.filename));
          const page1StoragePath = path.join(
            path.dirname(doc.storage_path),
            `${path.basename(doc.storage_path, ".pdf")}_page_1.pdf`
          );
          fs.writeFileSync(page1StoragePath, page1Buf);

          // Update current document to represent Page 1
          await db
            .update(schema.documents)
            .set({
              filename: `${baseName} (Page 1 of ${pageBuffers.length}).pdf`,
              storage_path: page1StoragePath,
            })
            .where(eq(schema.documents.id, id));

          activeBuffer = Buffer.from(page1Buf);

          // Create & background extract remaining pages
          for (let i = 1; i < pageBuffers.length; i++) {
            const pageBuf = pageBuffers[i];
            if (!pageBuf) continue;

            const pageStoragePath = path.join(
              path.dirname(doc.storage_path),
              `${path.basename(doc.storage_path, ".pdf")}_page_${i + 1}.pdf`
            );
            fs.writeFileSync(pageStoragePath, pageBuf);

            const [extraDoc] = await db
              .insert(schema.documents)
              .values({
                filename: `${baseName} (Page ${i + 1} of ${pageBuffers.length}).pdf`,
                file_type: "pdf",
                storage_path: pageStoragePath,
                status: "pending",
              })
              .returning();

            if (extraDoc) {
              void (async (targetDoc, targetBuf) => {
                try {
                  const extraIngest = await ingestFile(targetBuf, targetDoc.filename);
                  const extraExtract = await extractInvoice(extraIngest);
                  if (extraExtract.data) {
                    const [inv] = await db
                      .insert(schema.invoices)
                      .values({
                        document_id: targetDoc.id,
                        vendor_name: extraExtract.data.vendor_name,
                        invoice_number: extraExtract.data.invoice_number,
                        invoice_date: extraExtract.data.invoice_date,
                        grand_total: extraExtract.data.grand_total,
                        field_confidence: extraExtract.data.confidence,
                        needs_review: extraExtract.needsReview,
                        reviewed_by_human: false,
                      })
                      .returning();

                    if (inv && extraExtract.data.line_items.length > 0) {
                      await db.insert(schema.lineItems).values(
                        extraExtract.data.line_items.map((it) => ({
                          invoice_id: inv.id,
                          description: it.description,
                          qty: it.qty,
                          unit_price: it.unit_price,
                          total: it.total,
                        }))
                      );
                    }

                    await db
                      .update(schema.documents)
                      .set({
                        status: extraExtract.status,
                        raw_llm_response: extraExtract.rawResponse,
                      })
                      .where(eq(schema.documents.id, targetDoc.id));
                  }
                } catch (e) {
                  console.error(`[extract] Auto-extract extra page failed:`, e);
                }
              })(extraDoc, pageBuf);
            }
          }
        }
      } catch (err) {
        console.warn("[extract] Multi-page split check failed:", err);
      }
    }

    // 1. Ingestion
    const ingestionResult = await ingestFile(activeBuffer, doc.filename);

    // 2. Extraction & Heuristics
    const extractionResult = await extractInvoice(ingestionResult);

    // If completely failed: update status and return
    if (extractionResult.status === "failed_extraction" || !extractionResult.data) {
      await db
        .update(schema.documents)
        .set({
          status: "failed",
          raw_llm_response: extractionResult.rawResponse,
        })
        .where(eq(schema.documents.id, id));

      res.status(422).json({
        ok: false,
        status: "failed",
        error: extractionResult.errorMessage ?? "Extraction failed",
        reviewReasons: extractionResult.reviewReasons,
        rawResponse: extractionResult.rawResponse,
      });
      return;
    }

    const data = extractionResult.data;

    // Delete any existing invoice for this document (idempotent re-extraction)
    await db.delete(schema.invoices).where(eq(schema.invoices.document_id, id));

    // Insert invoice
    const [newInvoice] = await db
      .insert(schema.invoices)
      .values({
        document_id: id,
        vendor_name: data.vendor_name,
        invoice_number: data.invoice_number,
        invoice_date: data.invoice_date,
        grand_total: data.grand_total,
        field_confidence: data.confidence,
        needs_review: extractionResult.needsReview,
        reviewed_by_human: false,
      })
      .returning();

    if (!newInvoice) {
      throw new Error("Failed to persist invoice record");
    }

    // Insert line items
    const lineItemValues = data.line_items.map((item) => ({
      invoice_id: newInvoice.id,
      description: item.description,
      qty: item.qty,
      unit_price: item.unit_price,
      total: item.total,
    }));

    const insertedItems =
      lineItemValues.length > 0
        ? await db.insert(schema.lineItems).values(lineItemValues).returning()
        : [];

    // Update document status
    await db
      .update(schema.documents)
      .set({
        status: extractionResult.status,
        raw_llm_response: extractionResult.rawResponse,
      })
      .where(eq(schema.documents.id, id));

    res.json({
      ok: true,
      status: extractionResult.status,
      needsReview: extractionResult.needsReview,
      reviewReasons: extractionResult.reviewReasons,
      invoice: {
        ...newInvoice,
        line_items: insertedItems,
        extraction_notes: data.extraction_notes,
      },
    });
  } catch (err) {
    console.error(`[POST /documents/${id}/extract] Error:`, err);
    await db
      .update(schema.documents)
      .set({ status: "failed" })
      .where(eq(schema.documents.id, id));

    res.status(500).json({
      error: err instanceof Error ? err.message : "Extraction failed",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /documents
// ---------------------------------------------------------------------------
router.get("/", async (_req: Request, res: Response) => {
  try {
    const allDocs = await db.query.documents.findMany({
      orderBy: [desc(schema.documents.created_at)],
      with: {
        invoice: {
          columns: {
            id: true,
            vendor_name: true,
            invoice_number: true,
            grand_total: true,
            needs_review: true,
            reviewed_by_human: true,
          },
        },
      },
    });

    res.json({
      ok: true,
      documents: allDocs,
    });
  } catch (err) {
    console.error("[GET /documents] Error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch documents",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /documents/:id
// ---------------------------------------------------------------------------
router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Document ID is required" });
    return;
  }

  try {
    const doc = await db.query.documents.findFirst({
      where: eq(schema.documents.id, id),
      with: {
        invoice: {
          with: {
            lineItems: true,
          },
        },
      },
    });

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.json({
      ok: true,
      document: doc,
    });
  } catch (err) {
    console.error(`[GET /documents/${id}] Error:`, err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch document",
    });
  }
});

export default router;
