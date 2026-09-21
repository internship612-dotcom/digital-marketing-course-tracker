const { Client } = require("pg");
(async () => {
  const client = new Client({ host: "localhost", port: 5433, user: "postgres", password: "postgres", database: "course_tracker" });
  await client.connect();
  const { rows: cons } = await client.query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'teachers'::regclass");
  console.log("CONSTRAINTS:", JSON.stringify(cons, null, 2));
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });