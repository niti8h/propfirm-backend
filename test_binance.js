const { exec } = require("child_process");
exec("curl -s https://api.binance.com/api/v3/ticker/price", (err, stdout) => {
  if (err) { console.error(err); return; }
  const data = JSON.parse(stdout);
  console.log("Got", data.length, "tickers");
});
