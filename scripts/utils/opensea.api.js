const moment = require('moment');
const _ = require('lodash');
const axios = require('axios');

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

const oneDayInSeconds = 86400;

function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`;
}

async function getEventsForContract(startDate, endDate, contractAddress) {
  console.log('\nGetting events for contract address', contractAddress);

  let events = [];

  const endDateUnix = parseInt(endDate);
  let currentUnix = parseInt(startDate);
  let numOfRequests = 0;
  while (currentUnix + oneDayInSeconds <= endDateUnix) {
    numOfRequests += 1;
    const endDateTime = currentUnix + oneDayInSeconds - 1;

    console.log(`query OpenSea data from [${currentUnix}][${moment.unix(currentUnix).format()}] to [${endDateTime}][${moment.unix(endDateTime).format()}] - request [${numOfRequests}]`);

    const {data} = await axios.get(getOpenSeaUrl(contractAddress, currentUnix, endDateTime), {
      'X-API-KEY': OPENSEA_API_KEY
    });

    events = _.concat(events, data.asset_events);

    // add one day
    currentUnix += oneDayInSeconds;
  }

  if ((currentUnix + oneDayInSeconds) > endDateUnix && endDateUnix - currentUnix > 0) {
    numOfRequests += 1;
    console.log(`OpenSea request ${numOfRequests}`);

    const {data} = await axios.get(getOpenSeaUrl(contractAddress, currentUnix, endDateUnix), {
      'X-API-KEY': OPENSEA_API_KEY
    });

    events = _.concat(events, data.asset_events);
  }

  return events;
}

module.exports = {
  getEventsForContract
};
