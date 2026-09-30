const { Client } = require('pg');
const c = new Client('postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public');
c.connect()
  .then(() => c.query("SELECT usesuper FROM pg_user WHERE usename='postgres';"))
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(() => c.end());
