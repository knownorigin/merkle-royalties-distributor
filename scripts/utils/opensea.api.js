const moment = require('moment');
const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

const oneDayInSeconds = 86400;

function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`;
}

// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

async function getEventsForContract(version, startDate, endDate, contractAddress) {
  console.log('\nGetting events for contract address', contractAddress);

  let events = [];

  const endDateUnix = parseInt(endDate);
  let currentUnix = parseInt(startDate);
  let numOfRequests = 0;
  while (currentUnix + oneDayInSeconds <= endDateUnix) {
    numOfRequests += 1;
    const endDateTime = currentUnix + oneDayInSeconds - 1;

    console.log(`query OpenSea data from [${moment.unix(currentUnix).format()}] to [${moment.unix(endDateTime).format()}] - request [${numOfRequests}]`);

    const {data} = await axios.get(getOpenSeaUrl(contractAddress, currentUnix, endDateTime), {
      'X-API-KEY': OPENSEA_API_KEY
    });

    events = _.concat(events, data.asset_events);

    // add one day
    currentUnix += oneDayInSeconds;
  }

  if ((currentUnix + oneDayInSeconds) > endDateUnix && endDateUnix - currentUnix > 0) {
    numOfRequests += 1;
    console.log(`query OpenSea data from [${moment.unix(currentUnix).format()}] to [${moment.unix(endDateUnix).format()}] - request [${numOfRequests}]`);

    const {data} = await axios.get(getOpenSeaUrl(contractAddress, currentUnix, endDateUnix), {
      'X-API-KEY': OPENSEA_API_KEY
    });
    events = _.concat(events, data.asset_events);
  }

  console.log(`\nFound a total of [${events.length}] events for contract address`, contractAddress);

  if (events.length > 0) {
    const fileName = `${moment.unix(startDate).format('YYYY-DD-MM_HH-mm-ss')}_${moment.unix(endDate).format('YYYY-DD-MM_HH-mm-ss')}_${contractAddress}.json`;
    fs.writeFileSync(`./data/events/${fileName}`, JSON.stringify(events, null, 2));
  }

  return events;
}

const filterAndMapOpenSeaData = (vaultCommission, platformCommission, events) => {
  console.log('Filtering data for specific payment token [ETH]');

  // ensure we filter for the correct payment token and ensure we get back a token ID
  const filteredEvents = _.filter(events, (event) => {
    return (event.payment_token.symbol === 'ETH' || event.payment_token.symbol === 'WETH')
      && event.asset // ensure an asset
      && event.asset.token_id // ensure asset has a token ID
      && event.dev_fee_payment_event // ensure there is a dev payment event
      && event.dev_fee_payment_event.event_type // ensure that we can query event type
      && event.dev_fee_payment_event.event_type === 'payout' /// ensure type is payoyt
      && event.dev_fee_payment_event.transaction // ensure we can query tx
      && event.dev_fee_payment_event.transaction.transaction_hash // ensure there is a tx hash
      && !event.is_private; // ensure we are not looking at private events
  });

  console.log(`Mapping sale data for ${filteredEvents.length} events`);
  const modulo = ethers.BigNumber.from('100000');

  // map the events to common format we can work with
  const mappedData = _.map(filteredEvents, ({asset, total_price, created_date, transaction}) => {

    const totalPriceBn = ethers.BigNumber.from(total_price);
    const vaultCommissionScaledBn = ethers.BigNumber.from((parseFloat(vaultCommission) * 1000).toString());
    const platformCommissionScaledBn = ethers.BigNumber.from((parseFloat(platformCommission) * 1000).toString());
    const vault_commission = totalPriceBn.div(modulo).mul(vaultCommissionScaledBn);
    const platform_commission = vault_commission.div(modulo).mul(platformCommissionScaledBn);

    const amount_due_to_creators = vault_commission.sub(platform_commission);

    return {
      total_price,
      total_commission: total_price * (getFullCommissionTakenFromOpenSeaSale(parseFloat(vaultCommission)) / 100),
      vault_commission: vault_commission.toString(),
      opensea_commission: (total_price * (getFullCommissionTakenFromOpenSeaSale(0.0) / 100)).toString(),
      platform_commission: platform_commission.toString(),
      platform_commission_bn: platform_commission,
      amount_due_to_creators: amount_due_to_creators.toString(),
      amount_due_to_creators_bn: amount_due_to_creators,
      created_date,
      token_id: asset.token_id,
      timestamp: transaction.timestamp,
      txId: transaction.id
    };
  });

  // TODO is this valid - do batch trades share the same transaction ID ... ?

  // Get unique TX IDs only
  return _.uniqBy(
    // Sort by timestamp
    _.sortBy(mappedData, ['timestamp'])
    , 'txId');
};

module.exports = {
  getEventsForContract,
  filterAndMapOpenSeaData
};
