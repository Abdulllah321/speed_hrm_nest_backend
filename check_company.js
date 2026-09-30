const { Client } = require('pg');
const c = new Client('postgresql://postgres:root@localhost:5432/spl_core_db?schema=public');
c.connect()
  .then(() => c.query('SELECT name, "dbUser", "dbName" FROM "Company";'))
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(() => c.end());
