import {
  InvoiceExtractionSchema,
  type InvoiceExtraction,
} from "@invoice-extractor/shared";
import type { IngestionResult } from "./ingestion.js";
import { callLLMForExtraction, type LLMCallResult } from "./llm-client.js";
import { runHeuristics, type HeuristicCheckResult } from "./heuristics.js";

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export type ExtractionStatus =
  | "extracted"
  | "needs_review"
  | "failed_extraction";

export type ExtractionResult = {
  status: ExtractionStatus;
  data: InvoiceExtraction | null;
  /** Raw output from the LLM (for debugging and auditing). */
  rawResponse: unknown;
  /** Whether human review is required. */
  needsReview: boolean;
  /** List of reasons why review is required. */
  reviewReasons: string[];
  /** Breakdown of heuristic checks performed. */
  heuristicChecks?: HeuristicCheckResult["checks"];
  /** How many repair retries were executed (0 or 1). */
  retryCount: number;
  /** Which provider produced the result. */
  provider: LLMCallResult["provider"];
  /** Error message if extraction failed completely. */
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Extraction Service
// ---------------------------------------------------------------------------

/**
 * Extracts structured invoice data from an ingestion result (text or image).
 *
 * Flow:
 * 1. Invoke LLM with structured tool calling.
 * 2. Validate tool call arguments against InvoiceExtractionSchema.
 * 3. On schema failure: retry ONCE with a repair prompt including Zod issues.
 * 4. If repair still fails: return status = "failed_extraction" (do not crash).
 * 5. On valid schema: execute heuristic checks (line items sum, date validity, non-empty fields).
 * 6. If scanned/image document: unconditionally force needsReview = true.
 */
export async function extractInvoice(
  input: IngestionResult
): Promise<ExtractionResult> {
  const isScannedImage = input.type === "image";
  let retryCount = 0;
  let lastRawResponse: unknown = null;
  let provider: LLMCallResult["provider"] = "baseline";

  // Step 1: Initial LLM call
  let llmResult: LLMCallResult;
  try {
    llmResult = await callLLMForExtraction(input);
    lastRawResponse = llmResult.rawOutput;
    provider = llmResult.provider;
  } catch (err) {
    console.error("[extraction] LLM invocation error:", err);
    return {
      status: "failed_extraction",
      data: null,
      rawResponse: null,
      needsReview: true,
      reviewReasons: ["LLM API invocation failed"],
      retryCount: 0,
      provider: "baseline",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 2: Validate against InvoiceExtractionSchema
  let parseResult = InvoiceExtractionSchema.safeParse(llmResult.rawOutput);

  // Step 3: Single repair retry if initial validation failed
  if (!parseResult.success) {
    retryCount = 1;
    const errorMessages = parseResult.error.issues.map(
      (issue) => `[${issue.path.join(".")}] ${issue.message}`
    );

    console.warn(
      `[extraction] Initial extraction failed validation with ${errorMessages.length} errors. Triggering repair retry...`
    );

    try {
      llmResult = await callLLMForExtraction(input, {
        previousOutput: lastRawResponse,
        errors: errorMessages,
      });
      lastRawResponse = llmResult.rawOutput;
      provider = llmResult.provider;
      parseResult = InvoiceExtractionSchema.safeParse(llmResult.rawOutput);
    } catch (err) {
      return {
        status: "failed_extraction",
        data: null,
        rawResponse: lastRawResponse,
        needsReview: true,
        reviewReasons: ["Repair retry LLM call failed"],
        retryCount: 1,
        provider,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Step 4: If validation still fails after repair, return failed_extraction without crashing
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues.map(
      (issue) => `[${issue.path.join(".")}] ${issue.message}`
    );

    return {
      status: "failed_extraction",
      data: null,
      rawResponse: lastRawResponse,
      needsReview: true,
      reviewReasons: [
        "Schema validation failed after repair retry",
        ...errorMessages,
      ],
      retryCount: 1,
      provider,
      errorMessage: errorMessages.join("; "),
    };
  }

  // Step 5: Heuristic post-checks independent of model's reported confidence
  const validData: InvoiceExtraction = parseResult.data;
  const heuristics = runHeuristics(validData, isScannedImage);

  const status: ExtractionStatus = heuristics.needsReview
    ? "needs_review"
    : "extracted";

  return {
    status,
    data: validData,
    rawResponse: lastRawResponse,
    needsReview: heuristics.needsReview,
    reviewReasons: heuristics.reasons,
    heuristicChecks: heuristics.checks,
    retryCount,
    provider,
  };
}
