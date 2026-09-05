import type { InvoiceExtraction } from "@invoice-extractor/shared";

export type HeuristicCheckResult = {
  needsReview: boolean;
  reasons: string[];
  checks: {
    lineItemsSumMatch: boolean;
    validDate: boolean;
    requiredFieldsNonEmpty: boolean;
    isScannedImage: boolean;
    hasLowConfidence: boolean;
  };
};

/**
 * Validates extracted invoice data against business heuristics,
 * completely independent of the model's self-reported confidence.
 *
 * Rules:
 * 1. Do line item totals sum to grand_total within rounding tolerance (±0.05)?
 * 2. Is invoice_date a valid, parseable calendar date?
 * 3. Are all required fields non-empty?
 * 4. Is the input from a scanned/image document? (Forces needs_review unconditionally)
 * 5. Did the model self-report "low" confidence for any field?
 */
export function runHeuristics(
  data: InvoiceExtraction,
  isScannedImage: boolean
): HeuristicCheckResult {
  const reasons: string[] = [];

  // 1. Line items sum check
  const calculatedSum = data.line_items.reduce(
    (sum, item) => sum + item.total,
    0
  );
  // Round to 2 decimal places to avoid floating-point inaccuracies
  const roundedSum = Math.round(calculatedSum * 100) / 100;
  const roundedGrandTotal = Math.round(data.grand_total * 100) / 100;
  const diff = Math.abs(roundedSum - roundedGrandTotal);
  const lineItemsSumMatch = diff <= 0.05;

  if (!lineItemsSumMatch) {
    reasons.push(
      `Line item totals sum (${roundedSum.toFixed(2)}) does not match grand total (${roundedGrandTotal.toFixed(2)}, diff: ${diff.toFixed(2)})`
    );
  }

  // 2. Date check
  let validDate = false;
  const dateParts = data.invoice_date.split("-");
  if (dateParts.length === 3) {
    const year = parseInt(dateParts[0] ?? "", 10);
    const month = parseInt(dateParts[1] ?? "", 10);
    const day = parseInt(dateParts[2] ?? "", 10);

    if (
      !isNaN(year) &&
      !isNaN(month) &&
      !isNaN(day) &&
      year >= 1990 &&
      year <= 2100 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const parsedDate = new Date(Date.UTC(year, month - 1, day));
      validDate =
        parsedDate.getUTCFullYear() === year &&
        parsedDate.getUTCMonth() === month - 1 &&
        parsedDate.getUTCDate() === day;
    }
  }

  if (!validDate) {
    reasons.push(
      `Invoice date "${data.invoice_date}" is not a valid calendar date`
    );
  }

  // 3. Required fields non-empty
  const requiredFieldsNonEmpty =
    data.vendor_name.trim().length > 0 &&
    data.invoice_number.trim().length > 0 &&
    data.line_items.length > 0 &&
    data.line_items.every((item) => item.description.trim().length > 0);

  if (!requiredFieldsNonEmpty) {
    reasons.push("One or more required fields or line item descriptions are empty");
  }

  // 4. Scanned image rule (forces needs_review unconditionally)
  if (isScannedImage) {
    reasons.push(
      "Document ingested as scanned image — requires human review unconditionally"
    );
  }

  // 5. Model confidence check
  const lowConfidenceFields = Object.entries(data.confidence)
    .filter(([_, level]) => level === "low")
    .map(([field]) => field);

  const hasLowConfidence = lowConfidenceFields.length > 0;
  if (hasLowConfidence) {
    reasons.push(
      `Model self-reported low confidence for fields: ${lowConfidenceFields.join(", ")}`
    );
  }

  const needsReview =
    !lineItemsSumMatch ||
    !validDate ||
    !requiredFieldsNonEmpty ||
    isScannedImage ||
    hasLowConfidence;

  return {
    needsReview,
    reasons,
    checks: {
      lineItemsSumMatch,
      validDate,
      requiredFieldsNonEmpty,
      isScannedImage,
      hasLowConfidence,
    },
  };
}
