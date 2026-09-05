/**
 * Invoice 1 — Clean tabular layout, standard template
 * Vendor: Pinnacle Office Supplies Inc.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export function generateInvoice1(outputPath: string): void {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const BLUE = "#1a3a5c";
  const LIGHT_GRAY = "#f5f5f5";
  const MID_GRAY = "#888888";
  const RED = "#c0392b";

  // ── Header ────────────────────────────────────────────────────────────────
  doc
    .rect(0, 0, doc.page.width, 100)
    .fill(BLUE);

  doc
    .fillColor("white")
    .fontSize(28)
    .font("Helvetica-Bold")
    .text("PINNACLE OFFICE SUPPLIES INC.", 50, 28, { align: "left" });

  doc
    .fontSize(10)
    .font("Helvetica")
    .text("123 Commerce Boulevard, Suite 400", 50, 62)
    .text("Chicago, IL 60601  |  Tel: (312) 555-0192  |  ar@pinnacleoffice.com", 50, 76);

  // ── Invoice title block ───────────────────────────────────────────────────
  doc
    .fillColor(RED)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("INVOICE", doc.page.width - 200, 28, { align: "right" });

  doc
    .fillColor("#333333")
    .fontSize(10)
    .font("Helvetica")
    .text("Invoice No:", doc.page.width - 200, 58, { align: "right" })
    .text("INV-2024-0047", doc.page.width - 200, 70, {
      align: "right",
      continued: false,
    });

  // ── Bill To / Invoice Meta ────────────────────────────────────────────────
  doc.moveDown(3);
  const metaTop = 120;

  doc.fillColor(BLUE).fontSize(11).font("Helvetica-Bold").text("BILL TO:", 50, metaTop);
  doc
    .fillColor("#333333")
    .fontSize(10)
    .font("Helvetica")
    .text("Greenfield Manufacturing Corp.", 50, metaTop + 16)
    .text("Attn: Accounts Payable", 50, metaTop + 28)
    .text("789 Industrial Drive", 50, metaTop + 40)
    .text("Milwaukee, WI 53201", 50, metaTop + 52);

  const metaRightX = 350;
  const metaData: Array<[string, string]> = [
    ["Invoice Date:", "2024-01-15"],
    ["Due Date:", "2024-02-14"],
    ["Payment Terms:", "Net 30"],
    ["PO Number:", "PO-GF-88312"],
  ];

  metaData.forEach(([label, value], i) => {
    const y = metaTop + i * 16;
    doc.fillColor(MID_GRAY).font("Helvetica-Bold").fontSize(9).text(label, metaRightX, y);
    doc.fillColor("#333333").font("Helvetica").fontSize(9).text(value, 480, y, { align: "right" });
  });

  // ── Line items table ──────────────────────────────────────────────────────
  const tableTop = 230;
  const colX = { desc: 50, qty: 310, unit: 370, total: 450 };

  // Table header
  doc.rect(50, tableTop, doc.page.width - 100, 20).fill(BLUE);
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("DESCRIPTION", colX.desc + 4, tableTop + 6)
    .text("QTY", colX.qty, tableTop + 6)
    .text("UNIT PRICE", colX.unit, tableTop + 6)
    .text("TOTAL", colX.total, tableTop + 6);

  const lineItems = [
    { desc: "Premium Ballpoint Pens (Box of 50)", qty: 10, unit: 18.5 },
    { desc: "A4 Copy Paper – 80gsm (Ream of 500)", qty: 25, unit: 6.75 },
    { desc: 'Legal Pads – Yellow Ruled, 8.5"×11" (Pack of 12)', qty: 8, unit: 14.0 },
    { desc: "Stapler – Heavy Duty, 210-Sheet Capacity", qty: 3, unit: 42.0 },
    { desc: "File Folders – Hanging, Letter Size (Box of 25)", qty: 6, unit: 11.25 },
    { desc: "Whiteboard Markers – Assorted Colors (Set of 8)", qty: 12, unit: 7.99 },
  ];

  lineItems.forEach((item, i) => {
    const rowY = tableTop + 20 + i * 22;
    const total = item.qty * item.unit;

    if (i % 2 === 0) {
      doc.rect(50, rowY, doc.page.width - 100, 22).fill(LIGHT_GRAY);
    }

    doc
      .fillColor("#333333")
      .font("Helvetica")
      .fontSize(9)
      .text(item.desc, colX.desc + 4, rowY + 7, { width: 250 })
      .text(String(item.qty), colX.qty, rowY + 7)
      .text(`$${item.unit.toFixed(2)}`, colX.unit, rowY + 7)
      .text(`$${total.toFixed(2)}`, colX.total, rowY + 7);
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal = lineItems.reduce((s, i) => s + i.qty * i.unit, 0);
  const taxRate = 0.085;
  const tax = subtotal * taxRate;
  const grandTotal = subtotal + tax;

  const totalsY = tableTop + 20 + lineItems.length * 22 + 10;

  const drawTotalRow = (label: string, value: string, y: number, bold = false) => {
    doc
      .fillColor(bold ? BLUE : "#333333")
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 10 : 9)
      .text(label, 350, y)
      .text(value, colX.total, y);
  };

  drawTotalRow("Subtotal:", `$${subtotal.toFixed(2)}`, totalsY);
  drawTotalRow("Sales Tax (8.5%):", `$${tax.toFixed(2)}`, totalsY + 18);

  doc.moveTo(350, totalsY + 36).lineTo(doc.page.width - 50, totalsY + 36).stroke("#cccccc");

  doc.rect(350, totalsY + 40, doc.page.width - 400, 22).fill(BLUE);
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("GRAND TOTAL:", 354, totalsY + 47)
    .text(`$${grandTotal.toFixed(2)}`, colX.total, totalsY + 47);

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 80;
  doc
    .moveTo(50, footerY)
    .lineTo(doc.page.width - 50, footerY)
    .stroke("#cccccc");

  doc
    .fillColor(MID_GRAY)
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Payment due within 30 days. Please remit payment to: Pinnacle Office Supplies Inc. | " +
        "Bank: First National Bank | Routing: 071000013 | Account: 4401872935",
      50,
      footerY + 8,
      { align: "center" }
    )
    .text(
      "Late payments subject to 1.5% monthly finance charge. Thank you for your business!",
      50,
      footerY + 20,
      { align: "center" }
    );

  doc.end();

  stream.on("finish", () => {
    console.log(`  ✓ invoice_1.pdf written (${path.basename(outputPath)})`);
  });
}
