import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

export async function runMigrations(): Promise<void> {
  console.log(`[db:migrate] Running migrations from: ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log("[db:migrate] Migrations applied successfully.");
  } catch (err) {
    console.error("[db:migrate] Migration failed:", err);
    throw err;
  }
}

// If invoked directly from command line
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => client.end())
    .catch(async () => {
      await client.end();
      process.exit(1);
    });
}
