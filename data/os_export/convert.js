const csv = require('csv-parser');
const fs = require('fs');

// converts the csv into an 'override' object where we can look up overrides by token ID
(async function runScript() {
  let overrides = {}
  await new Promise((resolve) => {
    fs.createReadStream(`./data/os_export/os_export_ko_05_10_2021.csv`)
      .pipe(csv())
      .on('data', ({ token_id, address, fee }) => {
        overrides[token_id] = {
          contract: address,
          devFee: parseInt(fee) * 10
        }
      })
      .on('end', () => resolve())
  })

  fs.writeFileSync(`./data/os_export/05_10_2021_convert_to_json.json`, JSON.stringify(overrides, null, 2));
})()
