const { Client } = require('pg');
const c = new Client('postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public');
c.connect()
  .then(() => c.query("SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public' AND tableowner != 'user_speed_main_mox1gfsi';"))
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(() => c.end());
