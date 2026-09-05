import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import dotenv from "dotenv";

dotenv.config();

const connectionString =
  process.env["DATABASE_URL"] ??
  "postgresql://caderaedu@localhost:5433/invoice_extractor";

// For queries and migrations
export const client = postgres(connectionString, { max: 10 });
export const db = drizzle(client, { schema });

export { schema };
