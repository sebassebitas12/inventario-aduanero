import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL. Copia .env.example a .env y configura la conexión de Supabase.");
  process.exit(1);
}

const { app } = await import("./src/app.js");
const { pool } = await import("./src/db.js");
const port = Number(process.env.PORT || 4000);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`API lista en http://localhost:${port}`);
});

async function shutDown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
