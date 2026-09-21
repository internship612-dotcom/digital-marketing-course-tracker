const { Client } = require("pg");
(async () => {
  const c = new Client({ host: "localhost", port: 5433, user: "postgres", password: "postgres", database: "course_tracker" });
  await c.connect();
  const tables = ["students", "teachers", "admins", "attendance", "assessments", "sessions"];
  for (const t of tables) {
    const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(t, "=", r.rows[0].n);
  }
  const ids = await c.query("SELECT id FROM students");
  console.log("student ids:", JSON.stringify(ids.rows));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });