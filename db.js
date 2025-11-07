const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_PUBLIC_URL ||
    "postgresql://postgres:UCgDwgyEtVEONYWXDamtneFSUtmGuFYy@maglev.proxy.rlwy.net:37247/railway",
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("connect", () => {
  console.log("✅ Conexión a PostgreSQL establecida");
});

pool.on("error", (err) => {
  console.error("❌ Error en PostgreSQL:", err);
});

module.exports = pool;
