import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { ingestFile } from "../services/ingestion.js";
import { extractInvoice } from "../services/extraction.js";
import type { GroundTruth } from "@invoice-extractor/shared";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_INPUT = path.resolve(__dirname, "../../../../samples/input");
const SAMPLES_OUTPUT = path.resolve(__dirname, "../../../../samples/output");

const testCases = [
  { inputFile: "invoice_1.pdf", groundTruthFile: "invoice_1.json" },
  { inputFile: "invoice_2.pdf", groundTruthFile: "invoice_2.json" },
  { inputFile: "invoice_3_scanned.pdf", groundTruthFile: "invoice_3.json" },
  { inputFile: "invoice_4.xlsx", groundTruthFile: "invoice_4.json" },
];

type EvaluationRow = {
  file: string;
  vendorMatch: boolean;
  invoiceNumMatch: boolean;
  dateMatch: boolean;
  grandTotalMatch: boolean;
  lineItemsMatch: boolean;
  status: string;
  needsReview: boolean;
  overallMatch: boolean;
};

console.log("\n======================================================================");
console.log(" 🧠 Phase 5 — Extraction Service End-to-End Verification");
console.log("======================================================================\n");

const results: EvaluationRow[] = [];

for (const tc of testCases) {
  const inputPath = path.join(SAMPLES_INPUT, tc.inputFile);
  const gtPath = path.join(SAMPLES_OUTPUT, tc.groundTruthFile);

  if (!fs.existsSync(inputPath) || !fs.existsSync(gtPath)) {
    console.error(`Missing fixture: ${tc.inputFile} or ${tc.groundTruthFile}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(inputPath);
  const groundTruth = JSON.parse(fs.readFileSync(gtPath, "utf8")) as GroundTruth;

  console.log(`Processing: ${tc.inputFile}...`);
  const startTime = Date.now();

  // 1. Ingest
  const ingestionResult = await ingestFile(fileBuffer, tc.inputFile);

  // 2. Extract
  const extractionResult = await extractInvoice(ingestionResult);
  const elapsedMs = Date.now() - startTime;

  console.log(`  Ingestion type: ${ingestionResult.type} | Extraction status: ${extractionResult.status} (${elapsedMs}ms)`);
  if (extractionResult.reviewReasons.length > 0) {
    console.log(`  Review reasons: ${extractionResult.reviewReasons.join(" | ")}`);
  }

  const extracted = extractionResult.data;
  if (!extracted) {
    results.push({
      file: tc.inputFile,
      vendorMatch: false,
      invoiceNumMatch: false,
      dateMatch: false,
      grandTotalMatch: false,
      lineItemsMatch: false,
      status: extractionResult.status,
      needsReview: extractionResult.needsReview,
      overallMatch: false,
    });
    continue;
  }

  // Comparisons
  const vendorMatch =
    extracted.vendor_name.trim().toLowerCase() ===
    groundTruth.vendor_name.trim().toLowerCase();

  const invoiceNumMatch =
    extracted.invoice_number.trim().toUpperCase() ===
    groundTruth.invoice_number.trim().toUpperCase();

  const dateMatch = extracted.invoice_date === groundTruth.invoice_date;

  const grandTotalMatch =
    Math.abs(extracted.grand_total - groundTruth.grand_total) <= 0.05;

  const lineItemsMatch =
    extracted.line_items.length === groundTruth.line_items.length &&
    extracted.line_items.every((item, idx) => {
      const gt = groundTruth.line_items[idx];
      return (
        gt &&
        Math.abs(item.total - gt.total) <= 0.05 &&
        item.qty === gt.qty
      );
    });

  const overallMatch =
    vendorMatch &&
    invoiceNumMatch &&
    dateMatch &&
    grandTotalMatch &&
    lineItemsMatch;

  results.push({
    file: tc.inputFile,
    vendorMatch,
    invoiceNumMatch,
    dateMatch,
    grandTotalMatch,
    lineItemsMatch,
    status: extractionResult.status,
    needsReview: extractionResult.needsReview,
    overallMatch,
  });
}

// ---------------------------------------------------------------------------
// Accuracy Report
// ---------------------------------------------------------------------------

console.log("\n======================================================================");
console.log(" 📊 ACCURACY & EXTRACTION REPORT");
console.log("======================================================================\n");

console.table(
  results.map((r) => ({
    File: r.file,
    Vendor: r.vendorMatch ? "✓" : "✗",
    "Inv #": r.invoiceNumMatch ? "✓" : "✗",
    Date: r.dateMatch ? "✓" : "✗",
    Total: r.grandTotalMatch ? "✓" : "✗",
    Items: r.lineItemsMatch ? "✓" : "✗",
    Status: r.status,
    "Needs Review": r.needsReview ? "YES" : "NO",
    Accurate: r.overallMatch ? "PASS" : "FAIL",
  }))
);

const totalTested = results.length;
const accurateCount = results.filter((r) => r.overallMatch).length;
const scannedResult = results.find((r) => r.file === "invoice_3_scanned.pdf");

console.log(`\nAccuracy Summary: ${accurateCount}/${totalTested} (${Math.round((accurateCount / totalTested) * 100)}%) matched ground truth.`);
console.log(`Scanned PDF flagged needs_review: ${scannedResult?.needsReview ? "YES (PASSED)" : "NO (FAILED)"}`);

// Assertions per prompt rules:
// - At least 3/4 extract correctly
// - Scanned PDF is flagged needs_review
const passedThreshold = accurateCount >= 3;
const scannedNeedsReview = scannedResult?.needsReview === true;

if (passedThreshold && scannedNeedsReview) {
  console.log("\n✅  All Phase 5 verification requirements passed.\n");
} else {
  console.error("\n❌  Phase 5 verification failed.\n");
  process.exit(1);
}
