/**
 * Invoice 2 — Prose/paragraph style, non-standard field ordering.
 * Vendor: Hartwell & Associates Consulting Group
 *
 * Key differences from Invoice 1:
 * - No table — line items described in flowing paragraphs with embedded numbers
 * - Vendor info at bottom, not top
 * - Invoice number buried in a reference paragraph
 * - Date in a non-standard format ("Fifteenth of March, 2024")
 * - Grand total calculated with a "Professional Services Discount" line
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export function generateInvoice2(outputPath: string): void {
  const doc = new PDFDocument({ margin: 60, size: "LETTER" });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const GOLD = "#8B6914";
  const DARK = "#1a1a1a";
  const SUBTLE = "#666666";

  // ── Header (letterhead style) ─────────────────────────────────────────────
  doc
    .fontSize(20)
    .font("Helvetica-Bold")
    .fillColor(DARK)
    .text("HARTWELL & ASSOCIATES", { align: "center" })
    .font("Helvetica")
    .fontSize(12)
    .fillColor(GOLD)
    .text("CONSULTING GROUP", { align: "center" });

  doc
    .fillColor(SUBTLE)
    .fontSize(9)
    .text(
      "Suite 1200, Harrington Tower  ·  401 Park Avenue South  ·  New York, NY 10016",
      { align: "center" }
    )
    .text("T: +1 (212) 555-0841  ·  billing@hartwellcg.com  ·  www.hartwellcg.com", {
      align: "center",
    });

  doc.moveTo(60, 110).lineTo(doc.page.width - 60, 110).lineWidth(2).stroke(GOLD);

  // ── Reference block ───────────────────────────────────────────────────────
  doc.moveDown(1);
  doc
    .fillColor(DARK)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("CLIENT:", { continued: true })
    .font("Helvetica")
    .text("  Meridian Healthcare Partners LLC");

  doc
    .font("Helvetica-Bold")
    .text("ADDRESS:", { continued: true })
    .font("Helvetica")
    .text("  2200 Research Boulevard, Rockville, MD 20850");

  doc.moveDown(0.5);

  // Reference paragraph with invoice number buried inside
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(SUBTLE)
    .text(
      "This statement of account is rendered by Hartwell & Associates Consulting Group " +
        "pursuant to the Professional Services Agreement dated 15 November 2023. " +
        "Please reference invoice number HWA-2024-0312 on all correspondence and remittances. " +
        "Billing period: 01 March 2024 through 31 March 2024.",
      { align: "justify" }
    );

  doc.moveDown(0.5);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(DARK)
    .text("Statement Date: Fifteenth of March, 2024");

  doc.moveTo(60, doc.y + 6).lineTo(doc.page.width - 60, doc.y + 6).lineWidth(0.5).stroke("#cccccc");
  doc.moveDown(0.5);

  // ── Services rendered — prose style ──────────────────────────────────────
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(GOLD)
    .text("STATEMENT OF PROFESSIONAL SERVICES RENDERED");

  doc.moveDown(0.3);

  const services = [
    {
      title: "Executive Strategy Workshop",
      prose:
        "Facilitated a two-day executive strategy workshop for senior leadership at the Meridian " +
        "campus in Rockville. Services included pre-workshop stakeholder interviews, custom curriculum " +
        "development, facilitation (16 hours over 2 days), and post-workshop synthesis report. " +
        "Engagement lead: Dr. Claire Hartwell, Managing Partner. " +
        "Charged at our standard partner rate of $450.00 per hour × 16 hours = $7,200.00.",
      qty: 16,
      unit: 450.0,
      total: 7200.0,
    },
    {
      title: "Regulatory Compliance Review & Gap Analysis",
      prose:
        "Conducted a comprehensive review of Meridian's current compliance framework against updated " +
        "CMS guidelines (effective Q1 2024). Deliverables: gap analysis matrix, risk register, " +
        "and recommended remediation roadmap. This work engaged 3 senior consultants over " +
        "approximately 24 billable hours at $320.00 per consultant-hour, totalling $7,680.00.",
      qty: 24,
      unit: 320.0,
      total: 7680.0,
    },
    {
      title: "Monthly Retainer — Advisory Services (March 2024)",
      prose:
        "Standing monthly retainer covering ad-hoc advisory calls, document reviews, and email " +
        "correspondence. This is a fixed-fee engagement: 1 retainer × $3,500.00 = $3,500.00.",
      qty: 1,
      unit: 3500.0,
      total: 3500.0,
    },
    {
      title: "Travel & Out-of-Pocket Expenses",
      prose:
        "Reimbursable travel expenses incurred in connection with the on-site strategy workshop " +
        "(airfare, ground transport, accommodation). Receipts on file. 1 item × $1,248.50 = $1,248.50.",
      qty: 1,
      unit: 1248.5,
      total: 1248.5,
    },
  ];

  services.forEach((svc) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(DARK)
      .text(`\u2022  ${svc.title}`, { indent: 8 });

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(SUBTLE)
      .text(svc.prose, { indent: 20, align: "justify" });

    doc.moveDown(0.5);
  });

  // ── Totals block ──────────────────────────────────────────────────────────
  doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).lineWidth(0.5).stroke("#cccccc");
  doc.moveDown(0.4);

  const subtotal = services.reduce((s, svc) => s + svc.total, 0);
  const discount = 968.5; // "Preferred Client Discount"
  const grandTotal = subtotal - discount;

  const totalsStartX = 330;

  const writeTotalsRow = (label: string, value: string, bold = false) => {
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 11 : 9)
      .fillColor(bold ? DARK : SUBTLE)
      .text(label, totalsStartX, doc.y, { continued: true, width: 160 })
      .text(value, { align: "right" });
  };

  writeTotalsRow("Subtotal of services:", `$${subtotal.toFixed(2)}`);
  writeTotalsRow("Preferred Client Discount (–5%):", `–$${discount.toFixed(2)}`);
  doc
    .moveTo(totalsStartX, doc.y + 2)
    .lineTo(doc.page.width - 60, doc.y + 2)
    .stroke(GOLD);
  doc.moveDown(0.3);
  writeTotalsRow("TOTAL AMOUNT DUE:", `$${grandTotal.toFixed(2)}`, true);

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.moveDown(1.5);
  doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).lineWidth(1).stroke(GOLD);
  doc.moveDown(0.5);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(DARK)
    .text("REMITTANCE INSTRUCTIONS");

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(SUBTLE)
    .text(
      "Wire transfer: JPMorgan Chase Bank  ·  ABA Routing: 021000021  ·  Account: 789-654-3210  ·  SWIFT: CHASUS33\n" +
        "ACH / Check: Payable to 'Hartwell & Associates Consulting Group'. Please include invoice ref HWA-2024-0312.\n" +
        "Payment terms: Due within 30 days of invoice date. Late fee: 2% per 30-day period after due date.",
      { align: "justify" }
    );

  doc.moveDown(0.8);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(SUBTLE)
    .text(
      "Hartwell & Associates Consulting Group is registered in the State of New York. EIN: 47-1234567. " +
        "All services provided are subject to the Master Services Agreement. Thank you for your continued partnership.",
      { align: "center" }
    );

  doc.end();

  stream.on("finish", () => {
    console.log(`  ✓ invoice_2.pdf written (${path.basename(outputPath)})`);
  });
}
