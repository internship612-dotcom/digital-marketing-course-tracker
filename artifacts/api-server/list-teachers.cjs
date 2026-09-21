const { Client } = require("pg");
(async () => {
  const client = new Client({ host: "localhost", port: 5433, user: "postgres", password: "postgres", database: "course_tracker" });
  await client.connect();
  const { rows } = await client.query("select id, username, module, display_name, created_at from teachers order by id");
  console.log(JSON.stringify(rows, null, 2));
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });