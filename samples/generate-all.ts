/**
 * Master generator script — runs all 4 invoice generators and writes
 * ground-truth JSON to samples/output/.
 *
 * Run: pnpm --filter generate-samples generate
 *   OR: tsx generate-all.ts  (from within samples/)
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { generateInvoice1 } from "./generators/invoice1.js";
import { generateInvoice2 } from "./generators/invoice2.js";
import { generateInvoice3 } from "./generators/invoice3-scanned.js";
import { generateInvoice4 } from "./generators/invoice4.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR  = path.join(__dirname, "input");
const OUTPUT_DIR = path.join(__dirname, "output");

[INPUT_DIR, OUTPUT_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

console.log("\n📄 Generating sample invoice files...\n");

// ── Invoice files ─────────────────────────────────────────────────────────
generateInvoice1(path.join(INPUT_DIR, "invoice_1.pdf"));
generateInvoice2(path.join(INPUT_DIR, "invoice_2.pdf"));
generateInvoice3(path.join(INPUT_DIR, "invoice_3_scanned.pdf"));
generateInvoice4(path.join(INPUT_DIR, "invoice_4.xlsx"));

// ── Ground-truth JSON (GroundTruth schema — no confidence/extraction_notes) ─
const groundTruth1 = {
  vendor_name: "Pinnacle Office Supplies Inc.",
  invoice_number: "INV-2024-0047",
  invoice_date: "2024-01-15",
  line_items: [
    { description: "Premium Ballpoint Pens (Box of 50)", qty: 10, unit_price: 18.50, total: 185.00 },
    { description: "A4 Copy Paper – 80gsm (Ream of 500)", qty: 25, unit_price: 6.75, total: 168.75 },
    { description: 'Legal Pads – Yellow Ruled, 8.5"×11" (Pack of 12)', qty: 8, unit_price: 14.00, total: 112.00 },
    { description: "Stapler – Heavy Duty, 210-Sheet Capacity", qty: 3, unit_price: 42.00, total: 126.00 },
    { description: "File Folders – Hanging, Letter Size (Box of 25)", qty: 6, unit_price: 11.25, total: 67.50 },
    { description: "Whiteboard Markers – Assorted Colors (Set of 8)", qty: 12, unit_price: 7.99, total: 95.88 },
  ],
  grand_total: 812.01, // subtotal 755.13 + 8.5% tax = 819.32 — recalc below
};

// Recalculate grand total precisely
const sub1 = groundTruth1.line_items.reduce((s, i) => s + i.total, 0);
groundTruth1.grand_total = parseFloat((sub1 * 1.085).toFixed(2));

const groundTruth2 = {
  vendor_name: "Hartwell & Associates Consulting Group",
  invoice_number: "HWA-2024-0312",
  invoice_date: "2024-03-15",
  line_items: [
    { description: "Executive Strategy Workshop", qty: 16, unit_price: 450.00, total: 7200.00 },
    { description: "Regulatory Compliance Review & Gap Analysis", qty: 24, unit_price: 320.00, total: 7680.00 },
    { description: "Monthly Retainer — Advisory Services (March 2024)", qty: 1, unit_price: 3500.00, total: 3500.00 },
    { description: "Travel & Out-of-Pocket Expenses", qty: 1, unit_price: 1248.50, total: 1248.50 },
  ],
  grand_total: 18660.00, // subtotal 19628.50 - 968.50 discount
};

const groundTruth3 = {
  vendor_name: "Meridian Electrical Wholesale Ltd.",
  invoice_number: "MEW-2024-0199",
  invoice_date: "2024-02-08",
  line_items: [
    { description: "MCB 20A Single Pole (Unit)", qty: 50, unit_price: 4.20, total: 210.00 },
    { description: "2.5mm² Twin & Earth Cable (per metre)", qty: 200, unit_price: 1.15, total: 230.00 },
    { description: "Consumer Unit 18-Way Main Switch (Unit)", qty: 5, unit_price: 89.50, total: 447.50 },
    { description: "IP65 Junction Box 100×100mm (Unit)", qty: 30, unit_price: 3.80, total: 114.00 },
    { description: "Cable Trunking 50×50mm 3m Length (Each)", qty: 40, unit_price: 8.60, total: 344.00 },
  ],
  grand_total: 1345.50,
};

const groundTruth4 = {
  vendor_name: "Cascade Industrial Hardware Ltd.",
  invoice_number: "CIH-2024-0088",
  invoice_date: "2024-04-22",
  line_items: [
    { description: "M8 Hex Head Bolt – Stainless Steel A4 (Box/100)", qty: 20, unit_price: 8.40, total: 168.00 },
    { description: "M8 Nyloc Nut – Stainless Steel A4 (Box/100)", qty: 20, unit_price: 4.75, total: 95.00 },
    { description: "M8 Flat Washer – Grade 316 (Box/200)", qty: 15, unit_price: 3.20, total: 48.00 },
    { description: "M12 Threaded Rod 1000mm – HDG (Each)", qty: 50, unit_price: 6.80, total: 340.00 },
    { description: "Cold Rolled Steel Channel 12mm (per metre)", qty: 120, unit_price: 2.95, total: 354.00 },
    { description: "Steel Angle 50×50×5mm (per metre)", qty: 80, unit_price: 3.60, total: 288.00 },
    { description: "Heavy Duty Clasp – Zinc Plated (Each)", qty: 200, unit_price: 1.15, total: 230.00 },
    { description: "Freight & Delivery – UK to Oslo (DDP, Incoterms)", qty: 1, unit_price: 385.00, total: 385.00 },
  ],
  grand_total: 2406.00, // subtotal 1908.00 + 20% VAT
};

const sub4 = groundTruth4.line_items.reduce((s, i) => s + i.total, 0);
groundTruth4.grand_total = parseFloat((sub4 * 1.20).toFixed(2));

const truths = [
  ["invoice_1.json", groundTruth1],
  ["invoice_2.json", groundTruth2],
  ["invoice_3.json", groundTruth3],
  ["invoice_4.json", groundTruth4],
] as const;

truths.forEach(([filename, data]) => {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, filename),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
  console.log(`  ✓ ${filename} ground-truth written`);
});

console.log("\n✅ All sample files generated.\n");
