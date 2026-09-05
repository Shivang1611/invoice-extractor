# Project Notes & Explicitly Skipped Items

## Explicitly Skipped

- **Authentication (JWT / OAuth / Supabase Auth)**: Skipped because the take-home prompt focuses on extraction accuracy, schema validation, and human review UI.
- **Docker / Production Container Deployment**: Skipped to keep local development fast with native pnpm commands.
- **Python / Tesseract OCR**: Skipped due to hard constraint for 100% Node.js/TypeScript stack; vision-LLM used for scanned documents.
- **Multi-page PDF batch rasterization**: Skipped in initial ingestion service; currently renders page 0 which covers standard 1-page sample vendor invoices.
- **Real-time WebSockets / SSE**: Deferred in favor of standard polling or REST response during synchronous extraction.
- **Multi-model consensus voting**: Skipped in extraction service; single model invocation with 1-shot repair retry satisfies requirements.
