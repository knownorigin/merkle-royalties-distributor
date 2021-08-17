const _ = require('lodash');
const axios = require('axios');

// todo
// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`
}

task("open-sea-events", "Gets OpenSea sale events between 2 dates for an NFT")
  .addParam('nftAddress', 'ETH contract address for the NFT')
  .addParam('startDate', 'Start Date')
  .addParam('endDate', 'End Date')
  .addParam('tokenSymbol', "Events will be filtered for payments by this symbol i.e. 'ETH")
  .addParam('vaultCommission', "Commission sent to vault from an OpenSea sale")
  .addParam('platformCommission', "Of the commission sent to the vault, the percentage that goes to platform")
  .setAction(async taskArgs => {
    const {
      nftAddress,
      startDate,
      endDate,
      tokenSymbol,
      vaultCommission,
      platformCommission
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
      // ensure we filter for the correct payment token and ensure we get back a token ID
      return event.payment_token.symbol === tokenSymbol && event.asset && event.asset.token_id;
    });

    const transactionHashes = _.map(filteredEvents, 'transaction.transaction_hash');

    const mappedData = _.map(filteredEvents, ({asset, total_price, created_date}, index) => {
      const modulo = ethers.BigNumber.from('10000');
      const totalPriceBn = ethers.BigNumber.from(total_price)
      const vaultCommissionScaledBn = ethers.BigNumber.from((parseFloat(vaultCommission) * 100).toString());
      const platformCommissionScaledBn = ethers.BigNumber.from((parseFloat(platformCommission) * 100).toString());
      const vault_commission = totalPriceBn.div(modulo).mul(vaultCommissionScaledBn)
      const platform_commission = vault_commission.div(modulo).mul(platformCommissionScaledBn)

      const amountDueToCreators = vault_commission.sub(platform_commission)

      return {
        total_price,
        total_commission: total_price * (getFullCommissionTakenFromOpenSeaSale(parseFloat(vaultCommission)) / 100),
        vault_commission: vault_commission.toString(),
        opensea_commission: (total_price * (getFullCommissionTakenFromOpenSeaSale(0.0) / 100)).toString(),
        platform_commission: platform_commission.toString(),
        amountDueToCreators: amountDueToCreators.toString(),
        created_date,
        token_id: asset.token_id
      }
    });

    const totalAmount = _.sum(_.map(_.map(mappedData, 'total_price'), _.toNumber));
    const totalCommission = _.sum(_.map(_.map(mappedData, 'total_commission'), _.toNumber));
    const totalPlatformCommission = _.sum(_.map(_.map(mappedData, 'platform_commission'), _.toNumber));

    console.log('mappedData[0]', mappedData[0]);
    console.log('totalAmount', totalAmount);
    console.log('totalCommission', totalCommission);
    console.log('totalPlatformCommission', totalPlatformCommission);
  })
