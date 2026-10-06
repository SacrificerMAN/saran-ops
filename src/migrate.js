require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getPool, usePg } = require("./db");

async function main() {
  if (!usePg()) {
    console.log("No DATABASE_URL — skip migrate (memory mode)");
    process.exit(0);
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  const pool = getPool();
  await pool.query(sql);
  console.log("Migration OK");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
