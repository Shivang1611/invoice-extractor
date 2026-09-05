/**
 * Test script for the ingestion service.
 *
 * Runs all 4 sample files through ingestFile() and logs:
 *   - Which routing path was taken (text vs image)
 *   - Character count or base64 length
 *   - A text preview (first 300 chars)
 *
 * Usage:
 *   pnpm --filter api tsx src/scripts/test-ingestion.ts
 *   OR from api directory:
 *   ../../node_modules/.pnpm/node_modules/.bin/tsx src/scripts/test-ingestion.ts
 *
 * Expected output:
 *   invoice_1.pdf  → type: text
 *   invoice_2.pdf  → type: text
 *   invoice_3_scanned.pdf → type: image  ← must be this
 *   invoice_4.xlsx → type: text
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ingestFile } from "../services/ingestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve samples/input relative to the monorepo root (4 levels up from src/scripts/)
const SAMPLES_INPUT = path.resolve(__dirname, "../../../../samples/input");

const testFiles = [
  "invoice_1.pdf",
  "invoice_2.pdf",
  "invoice_3_scanned.pdf",
  "invoice_4.xlsx",
];

console.log("\n🔬 Testing ingestion service on all 4 sample files...\n");
console.log("=".repeat(70));

let allPassed = true;

for (const filename of testFiles) {
  const filePath = path.join(SAMPLES_INPUT, filename);
  console.log(`\n📎 ${filename}`);

  if (!fs.existsSync(filePath)) {
    console.error(`  ✗ File not found: ${filePath}`);
    allPassed = false;
    continue;
  }

  const buffer = fs.readFileSync(filePath) as Buffer;

  try {
    const result = await ingestFile(buffer, filename);

    if (result.type === "text") {
      const preview = result.content.slice(0, 300).replace(/\n/g, "↵");
      console.log(`  ✓ type: text | chars: ${result.charCount}`);
      console.log(`  Preview: "${preview}${result.content.length > 300 ? "…" : ""}"`);
    } else {
      const base64Len = result.base64.length;
      const approxKb = Math.round((base64Len * 3) / 4 / 1024);
      console.log(`  ✓ type: image | base64 length: ${base64Len} (~${approxKb} KB PNG) | page: ${result.pageIndex}`);
      console.log(`  mimeType: ${result.mimeType}`);
    }

    // Assertions
    if (filename === "invoice_3_scanned.pdf" && result.type !== "image") {
      console.error(`  ✗ ASSERTION FAILED: scanned PDF should route to image, got: ${result.type}`);
      allPassed = false;
    } else if (filename !== "invoice_3_scanned.pdf" && result.type !== "text") {
      console.error(`  ✗ ASSERTION FAILED: ${filename} should route to text, got: ${result.type}`);
      allPassed = false;
    }
  } catch (err) {
    console.error(`  ✗ Error:`, err instanceof Error ? err.message : err);
    allPassed = false;
  }
}

console.log("\n" + "=".repeat(70));
if (allPassed) {
  console.log("✅  All ingestion routing assertions passed.\n");
} else {
  console.error("❌  One or more assertions FAILED.\n");
  process.exit(1);
}
