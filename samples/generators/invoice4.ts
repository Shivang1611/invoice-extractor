/**
 * Invoice 4 — Excel file with merged cells and unconventional layout.
 * Vendor: Cascade Industrial Hardware Ltd.
 *
 * Layout quirks:
 * - Company name spans A1:F1 (merged)
 * - Invoice metadata scattered across non-adjacent cells
 * - "TOTAL" label in column E, value in column F — offset from data rows
 * - A "Notes" section embedded below the line items, same sheet
 * - One spacer row between header and items, one between items and totals
 */
import * as XLSX from "xlsx";
import path from "path";

export function generateInvoice4(outputPath: string): void {
  const wb = XLSX.utils.book_new();

  // ── Build a worksheet with manual cell placement ────────────────────────
  // We use a "sparse" approach: set each cell individually so we have full
  // control over merges and layout.
  const ws: XLSX.WorkSheet = {};

  // Helper to set cell with optional style hint in comment
  const C = (addr: string, v: string | number, t: XLSX.ExcelDataType = "s") => {
    ws[addr] = { v, t } satisfies XLSX.CellObject;
  };

  // ── Row 1: Company header (A1:F1 merged) ─────────────────────────────────
  C("A1", "CASCADE INDUSTRIAL HARDWARE LTD.");
  // Empty filler cells that will be part of the merge range
  ["B1", "C1", "D1", "E1", "F1"].forEach((a) => C(a, ""));

  // Row 2: Address line (A2:F2 merged)
  C("A2", "Unit 7, Ironworks Business Park  |  Sheffield, S9 2LP  |  UK");
  ["B2", "C2", "D2", "E2", "F2"].forEach((a) => C(a, ""));

  // Row 3: blank separator
  C("A3", "");

  // ── Rows 4-7: Invoice metadata — intentionally scattered ─────────────────
  C("A4", "Invoice Number:");   C("B4", "CIH-2024-0088");
  C("D4", "Invoice Date:");     C("E4", "22-Apr-2024");    // non-ISO date

  C("A5", "Bill To:");          C("B5", "Nordvik Construction Group AS");
  C("D5", "Due Date:");         C("E5", "22-May-2024");

  C("A6", "Client Address:");   C("B6", "Grensen 7, 0159 Oslo, Norway");
  C("D6", "Payment Terms:");    C("E6", "Net 30");

  C("A7", "VAT Reg No:");       C("B7", "GB 123 4567 89");
  C("D7", "Currency:");         C("E7", "GBP (£)");

  // Row 8: blank spacer
  C("A8", "");

  // ── Row 9: Line items header ──────────────────────────────────────────────
  C("A9", "Line");
  C("B9", "Item Code");
  C("C9", "Description");
  C("D9", "Qty");
  C("E9", "Unit Price (£)");
  C("F9", "Line Total (£)");

  // ── Rows 10-17: Line items ────────────────────────────────────────────────
  const items = [
    { line: 1, code: "M8-HEX-SS",   desc: "M8 Hex Head Bolt – Stainless Steel A4 (Box/100)",  qty: 20,  unit: 8.40 },
    { line: 2, code: "NUT-M8-NY",   desc: "M8 Nyloc Nut – Stainless Steel A4 (Box/100)",       qty: 20,  unit: 4.75 },
    { line: 3, code: "WAS-M8-FL",   desc: "M8 Flat Washer – Grade 316 (Box/200)",               qty: 15,  unit: 3.20 },
    { line: 4, code: "THD-ROD-M12", desc: "M12 Threaded Rod 1000mm – HDG (Each)",               qty: 50,  unit: 6.80 },
    { line: 5, code: "CHP-12mm",    desc: "Cold Rolled Steel Channel 12mm (per metre)",          qty: 120, unit: 2.95 },
    { line: 6, code: "ANG-50x50",   desc: "Steel Angle 50×50×5mm (per metre)",                  qty: 80,  unit: 3.60 },
    { line: 7, code: "HVY-DUTY-CLASP", desc: "Heavy Duty Clasp – Zinc Plated (Each)",           qty: 200, unit: 1.15 },
    { line: 8, code: "FREIGHT-UK",  desc: "Freight & Delivery – UK to Oslo (DDP, Incoterms)",   qty: 1,   unit: 385.0 },
  ];

  items.forEach((item, i) => {
    const row = 10 + i;
    const total = item.qty * item.unit;
    C(`A${row}`, item.line, "n");
    C(`B${row}`, item.code);
    C(`C${row}`, item.desc);
    C(`D${row}`, item.qty, "n");
    C(`E${row}`, item.unit, "n");
    C(`F${row}`, total, "n");
  });

  // ── Row 18: spacer ────────────────────────────────────────────────────────
  C("A18", "");

  // ── Rows 19-23: Totals (offset: label in E, value in F) ──────────────────
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit, 0);
  const vatRate = 0.20;
  const vat = subtotal * vatRate;
  const grandTotal = subtotal + vat;

  C("E19", "Subtotal:");          C("F19", subtotal, "n");
  C("E20", "VAT (20%):");         C("F20", vat, "n");
  C("E21", "");                   C("F21", "");  // visual spacer
  C("E22", "GRAND TOTAL (£):");   C("F22", grandTotal, "n");

  // ── Rows 24-28: Notes section ─────────────────────────────────────────────
  C("A24", "");
  C("A25", "NOTES & TERMS:");
  C("A26", "All prices in GBP. VAT applied at standard UK rate (20%) on all goods and services.");
  C("A27", "Goods remain property of Cascade Industrial Hardware Ltd. until payment received in full.");
  C("A28", "Disputes must be notified in writing within 7 days of invoice date. E&OE.");

  // ── Row 29: Authorised Signature ─────────────────────────────────────────
  C("A29", "");
  C("A30", "Authorised by:");     C("B30", "Sandra M. Brooksbank, Head of Finance");
  C("D30", "Date Authorised:");   C("E30", "22-Apr-2024");

  // ── Merge ranges ──────────────────────────────────────────────────────────
  ws["!merges"] = [
    // Company header spans A1:F1
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    // Address line spans A2:F2
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    // Description column spans C (wider)
    { s: { r: 8, c: 2 }, e: { r: 8, c: 2 } },
    // Notes text spans A26:F26, A27:F27, A28:F28
    { s: { r: 25, c: 0 }, e: { r: 25, c: 5 } },
    { s: { r: 26, c: 0 }, e: { r: 26, c: 5 } },
    { s: { r: 27, c: 0 }, e: { r: 27, c: 5 } },
    // Authorised by
    { s: { r: 29, c: 1 }, e: { r: 29, c: 2 } },
  ] satisfies XLSX.Range[];

  // ── Column widths ─────────────────────────────────────────────────────────
  ws["!cols"] = [
    { wch: 18 }, // A
    { wch: 16 }, // B
    { wch: 48 }, // C — description
    { wch: 8  }, // D
    { wch: 18 }, // E
    { wch: 14 }, // F
  ];

  // ── Sheet range ───────────────────────────────────────────────────────────
  ws["!ref"] = "A1:F30";

  XLSX.utils.book_append_sheet(wb, ws, "Invoice CIH-2024-0088");
  XLSX.writeFile(wb, outputPath);

  console.log(`  ✓ invoice_4.xlsx written (${path.basename(outputPath)})`);
}
