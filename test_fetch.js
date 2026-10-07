const http = require('http');

const server = http.createServer((req, res) => {
  console.log("Headers:", req.headers);
  res.end("OK");
});
server.listen(9999, async () => {
  console.log("Server listening");
  await fetch('http://localhost:9999', {
    method: 'POST',
    body: JSON.stringify({ a: 1 })
  });
  server.close();
});
