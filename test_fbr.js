const https = require('https');
const token = "invalid-token-12345";

async function test(url) {
  const payload = {
    InvoiceNumber: "", POSID: 125618, USIN: "SI-NDC26-21565-TEST8", DateTime: "2026-09-29 21:54:45",
    TotalSaleValue: 16241.04, TotalTaxCharged: 4060.26, TotalQuantity: 1, Discount: 5358.96, FurtherTax: 0, TotalBillAmount: 20301.3,
    PaymentMode: 1, InvoiceType: 1, RefUSIN: null, Items: [{
      ItemCode: "FV5285-012", ItemName: "M NIKE PROMINA", PCTCode: "64041900", Quantity: 1,
      TaxRate: 25, SaleValue: 16241.04, Discount: 5358.96, FurtherTax: 0, TaxCharged: 4060.26, TotalAmount: 20301.3, InvoiceType: 1, RefUSIN: null
    }]
  };

  const makeReq = (data) => new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      rejectUnauthorized: false
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });

  try { console.log(`Invalid token response:`, await makeReq(payload)); } catch(e) {}
}
test('https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData');
