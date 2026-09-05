import express, { type Express } from "express";
import cors from "cors";
import dotenv from "dotenv";
import documentsRouter from "./routes/documents.js";
import invoicesRouter from "./routes/invoices.js";

dotenv.config();

const app: Express = express();
const PORT = process.env["PORT"] ?? 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use("/documents", documentsRouter);
app.use("/invoices", invoicesRouter);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "invoice-extractor-api",
    ts: new Date().toISOString(),
  });
});

if (process.env["NODE_ENV"] !== "test") {
  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
  });
}

export default app;
