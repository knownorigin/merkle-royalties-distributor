const moment = require('moment');
const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

const oneDayInSeconds = 86400;

function getOpenSeaUrl(startDate, endDate, eventType, limit = 300) {
  return `https://api.opensea.io/api/v1/events?collection_slug=known-origin&event_type=${eventType}&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`;
}

// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

async function getEventsForContract(version, startDate, endDate, eventType = 'successful') {
  console.log('\nGetting events for all KO contracts');

  let events = [];

  const endDateUnix = parseInt(endDate);
  let currentUnix = parseInt(startDate);
  let numOfRequests = 0;
  while (currentUnix + oneDayInSeconds <= endDateUnix) {
    numOfRequests += 1;
    const endDateTime = currentUnix + oneDayInSeconds - 1;

    console.log(`query OpenSea data from [${moment.unix(currentUnix).format()}] to [${moment.unix(endDateTime).format()}] - request [${numOfRequests}]`);

    const {data} = await axios.get(getOpenSeaUrl(currentUnix, endDateTime, eventType), {
      'X-API-KEY': OPENSEA_API_KEY,
      headers: {
        'X-API-KEY': OPENSEA_API_KEY,
        'Accept': 'application/json'
      }
    });

    events = _.concat(events, data.asset_events);

    // add one day
    currentUnix += oneDayInSeconds;
  }

  if ((currentUnix + oneDayInSeconds) > endDateUnix && endDateUnix - currentUnix > 0) {
    numOfRequests += 1;
    console.log(`query OpenSea data from [${moment.unix(currentUnix).format()}] to [${moment.unix(endDateUnix).format()}] - request [${numOfRequests}]`);

    const {data} = await axios.get(getOpenSeaUrl(currentUnix, endDateUnix, eventType), {
      'X-API-KEY': OPENSEA_API_KEY,
      headers: {
        'X-API-KEY': OPENSEA_API_KEY,
        'Accept': 'application/json'
      }
    });
    events = _.concat(events, data.asset_events);
  }

  console.log(`\nFound a total of [${events.length}] events`);

  if (events.length > 0) {
    const fileName = `${moment.unix(startDate).format('YYYY-DD-MM_HH-mm-ss')}_${moment.unix(endDate).format('YYYY-DD-MM_HH-mm-ss')}_v2_v3.json`;
    fs.writeFileSync(`./data/events/${fileName}`, JSON.stringify(events, null, 2));
  }

  return events;
}

const filterAndMapOpenSeaEthData = (vaultCommission, platformCommission, events, devFeeOverridesForTokens, fromTokenId = 4500) => {
  console.log('Filtering data for specific payment token [ETH]');

  // ensure we filter for the correct payment token and ensure we get back a token ID
  const removedEvents = [];

  const filteredEvents = _.filter(events, (event) => {
    const isIncluded =
      (event.payment_token.symbol === 'ETH' || event.payment_token.symbol === 'WETH')
      && event.asset // ensure an asset
      && event.asset.token_id // ensure asset has a token ID
      && event.dev_seller_fee_basis_points // ensure the dev fee set when item was listed is present

    if (!isIncluded && event.asset && event.asset.token_id) {
      removedEvents.push(event)
    }

    return isIncluded;
  });

  if (removedEvents.length > 0) {
    console.log('number of removed events from open sea event list', removedEvents.length)
    const fileName = `${moment.unix(Date.now() / 1000).format('YYYY-DD-MM_HH-mm-ss')}_removed_tokens.json`;
    fs.writeFileSync(`./data/events/${fileName}`, JSON.stringify(removedEvents, null, 2));
  }

  console.log(`Mapping sale data for ${filteredEvents.length} events`);
  const modulo = ethers.BigNumber.from('100000');

  // map the events to common format we can work with
  const mappedData = _.map(filteredEvents, ({asset, total_price, created_date, transaction, dev_seller_fee_basis_points}) => {

    let _vaultCommission = dev_seller_fee_basis_points / 100
    const token_id = asset.token_id

    if (devFeeOverridesForTokens && devFeeOverridesForTokens[token_id.toString()]) {
      _vaultCommission = parseFloat(devFeeOverridesForTokens[token_id.toString()].devFee) / 1000.00
      console.log(_vaultCommission)
    }

    const totalPriceBn = ethers.BigNumber.from(total_price);
    const vaultCommissionScaledBn = ethers.BigNumber.from((parseFloat(_vaultCommission) * 1000).toString());
    const platformCommissionScaledBn = ethers.BigNumber.from((parseFloat(platformCommission) * 1000).toString());
    const vault_commission = totalPriceBn.div(modulo).mul(vaultCommissionScaledBn);
    const platform_commission = vault_commission.div(modulo).mul(platformCommissionScaledBn);

    const amount_due_to_creators = vault_commission.sub(platform_commission);

    return {
      total_price,
      total_commission: total_price * (getFullCommissionTakenFromOpenSeaSale(parseFloat(_vaultCommission)) / 100),
      vault_commission: vault_commission.toString(),
      opensea_commission: (total_price * (getFullCommissionTakenFromOpenSeaSale(0.0) / 100)).toString(),
      platform_commission: platform_commission.toString(),
      platform_commission_bn: platform_commission,
      amount_due_to_creators: amount_due_to_creators.toString(),
      amount_due_to_creators_bn: amount_due_to_creators,
      created_date,
      token_id,
      timestamp: transaction.timestamp,
      txId: transaction.id
    };
  });

  // Get unique TX IDs only
  return _.uniqBy(
    // Sort by timestamp
    _.sortBy(mappedData, ['timestamp'])
    , 'txId');
};

module.exports = {
  getEventsForContract,
  filterAndMapOpenSeaEthData
};
