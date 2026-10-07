const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/pos-sales/orders?limit=10',
  method: 'GET',
  headers: {
    'Cookie': 'posTerminalToken=dummy'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log("Status Code:", res.statusCode);
    try {
      const json = JSON.parse(data);
      const items = json.data || [];
      const returns = items.filter(i => i.isReturnRow);
      console.log("Found return rows:", returns.length);
      if (returns.length > 0) {
        console.log("First return row originalOrderId:", returns[0].originalOrderId);
        console.log("First return row id:", returns[0].id);
      } else {
          console.log("All IDs:", items.map(i => i.id));
      }
    } catch(e) {
      console.error("Parse error:", e);
    }
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.end();
