const _ = require('lodash');
const axios = require('axios');

function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`
}

task("open-sea-events", "Gets OpenSea sale events between 2 dates for an NFT")
  .addParam('nftAddress', 'ETH contract address for the NFT')
  .addParam('startDate', 'Start Date')
  .addParam('endDate', 'End Date')
  .addParam('tokenSymbol', "Events will be filtered for payments by this symbol i.e. 'ETH")
  .setAction(async taskArgs => {
    const {
      nftAddress,
      startDate,
      endDate,
      tokenSymbol
    } = taskArgs

    // TODO get data per day with 300 limit
    // TODO gather data and dump to file
    // TODO churn data and determine allocations + sense checks on output
    // TODO churn data and build trie 

    const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY

    const {data} = await axios.get(getOpenSeaUrl(nftAddress, startDate, endDate), {
      'X-API-KEY': OPENSEA_API_KEY
    })

    const filteredEvents = _.filter(data.asset_events, (event) => {
      return event.payment_token.symbol === tokenSymbol;
    });

    console.log('filteredEvents', filteredEvents);
  })
