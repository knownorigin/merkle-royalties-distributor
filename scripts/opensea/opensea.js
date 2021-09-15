const _ = require('lodash');
const axios = require('axios');
const {request, gql} = require('graphql-request');
const {parseNodesAndBuildMerkleTree} = require('../../utils/parse-nodes');
const moment = require("moment");

const fs = require('fs');

const oneDayInSeconds = 86400;

// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`;
}

task("open-sea-events", "Gets OpenSea sale events between 2 dates for an NFT")
  //.addParam('nftAddress', 'ETH contract address for the NFT')
.addParam('startDate', 'Start Date')
.addParam('endDate', 'End Date')
  //.addParam('tokenSymbol', "Events will be filtered for payments by this symbol i.e. 'ETH") // todo - enable later
.addParam('vaultCommission', "Commission sent to vault from an OpenSea sale")
.addParam('platformCommission', "Of the commission sent to the vault, the percentage that goes to platform")
.addParam('platformAccount', "Platform account address that will receive a split of the vault")
.addParam('merkleTreeVersion', 'The version of the file to pin')
.addParam('ethPayoutAmount', 'Amount of ETH that was last paid by OpenSea')
.setAction(async taskArgs => {
    const {
      // nftAddress,
      startDate,
      endDate,
      // tokenSymbol,
      vaultCommission,
      platformCommission,
      platformAccount,
      merkleTreeVersion,
      ethPayoutAmount
    } = taskArgs;

    console.log(`Starting task...`);

    const expectedETH = ethers.utils.parseEther(ethPayoutAmount)

    const KODAV2ContractAddress = '0xfbeef911dc5821886e1dda71586d90ed28174b7d'
    const KODAV3ContractAddress = '0xabb3738f04dc2ec20f4ae4462c3d069d02ae045b'

    // TODO churn data and determine allocations + sense checks on output

    const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

    let events = [];

    async function getEventsForContract(contractAddress) {
      console.log('\nGetting events for contract address', contractAddress)

      const endDateUnix = parseInt(endDate);
      let currentUnix = parseInt(startDate);
      let numOfRequests = 0;
      while (currentUnix + oneDayInSeconds <= endDateUnix) {
        numOfRequests += 1;
        console.log(`OpenSea request ${numOfRequests}`);

        const {data} = await axios.get(getOpenSeaUrl(contractAddress, currentUnix, currentUnix + oneDayInSeconds - 1), {
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
    }

    await getEventsForContract(KODAV2ContractAddress);
    //await getEventsForContract(KODAV3ContractAddress);

    console.log('Filtering data for specific payment token [ETH]');
    const filteredEvents = _.filter(events, (event) => {
      // ensure we filter for the correct payment token and ensure we get back a token ID
      return (event.payment_token.symbol === 'ETH' || event.payment_token.symbol === 'WETH')
        && event.asset // ensure an asset
        && event.asset.token_id // ensure asset has a token ID
        && event.dev_fee_payment_event // ensure there is a dev payment event
        && event.dev_fee_payment_event.event_type // ensure that we can query event type
        && event.dev_fee_payment_event.event_type === "payout" /// ensure type is payoyt
        && event.dev_fee_payment_event.transaction // ensure we can query tx
        && event.dev_fee_payment_event.transaction.transaction_hash // ensure there is a tx hash
        && !event.is_private // ensure we are not looking at private events
    });

    // for ETH based payments, we encode the token as the zero address in the tree
    const token = '0x0000000000000000000000000000000000000000';

    console.log(`Mapping sale data for ${filteredEvents.length} events`);
    const modulo = ethers.BigNumber.from('100000');

    let mappedData = _.map(filteredEvents, ({asset, total_price, created_date, transaction}) => {
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

    mappedData = _.sortBy(mappedData, ["timestamp"])
    mappedData = _.uniqBy(mappedData, 'txId');

    const totalPlatformCommission = mappedData.reduce((memo, {platform_commission_bn}) => {
      return memo.add(platform_commission_bn);
    }, ethers.BigNumber.from('0'));

    const totalAmountDueToCreators = mappedData.reduce((memo, {amount_due_to_creators_bn}) => {
      return memo.add(amount_due_to_creators_bn);
    }, ethers.BigNumber.from('0'));

    let counter = totalAmountDueToCreators.add(totalPlatformCommission)
    let platformCommissionCounter = totalPlatformCommission
    if (totalAmountDueToCreators.add(totalPlatformCommission).gt(expectedETH)) {
      console.log('More ETH in events than expected! Filtering out events and dumping to file')

      counter = ethers.BigNumber.from('0')
      platformCommissionCounter = ethers.BigNumber.from('0')
      let filteredEvents = []
      for(let i = 0; i < mappedData.length; i++) {
        const mData = mappedData[i]
        const commissionDueForToken = mData.platform_commission_bn.add(mData.amount_due_to_creators_bn)

        if (counter.add(commissionDueForToken).lte(expectedETH)) {
          counter = counter.add(commissionDueForToken)
          platformCommissionCounter = platformCommissionCounter.add(mData.platform_commission_bn)
          filteredEvents.push(mData)
        }
      }

      console.log(`Expected amount [${expectedETH.toString()}] vs total in events [${totalAmountDueToCreators.add(totalPlatformCommission).toString()}] vs new amount [${counter.toString()}]`)
      console.log('num of events not included', mappedData.length - filteredEvents.length)
      console.log('first timestamp', filteredEvents[0].timestamp)
      console.log('last timestamp', filteredEvents[filteredEvents.length-1].timestamp)

      const diff = _.difference(mappedData, filteredEvents)
      fs.writeFileSync(`./data/removed-${merkleTreeVersion}.json`, JSON.stringify(diff, null, 2));

      mappedData = filteredEvents
    }

    console.log(`Looking up platform data for ${mappedData.length} events`);
    const allMerkleTreeNodes = [];
    for (let i = 0; i < mappedData.length; i++) {
      console.log(`${mappedData.length - (i + 1)} lookups left`);
      const koLookupQuery = gql`
          query getTokens($id: String!) {
              tokens(where:{id: $id}) {
                  id
                  version
                  edition {
                      id
                      version
                      artistAccount
                      optionalCommissionAccount
                      optionalCommissionRate
                      collective {
                          recipients
                          splits
                      }
                  }
              }
          }
      `;

      const mData = mappedData[i];

      const reqRes = await request(
        'https://api.thegraph.com/subgraphs/name/knownorigin/known-origin',
        koLookupQuery,
        {
          id: mData.token_id
        }
      );

      if (!reqRes || !reqRes.tokens || !reqRes.tokens[0]) continue;

      const {edition, version} = reqRes.tokens[0];

      // this must be compliant with utils/parse-nodes.js
      // i.e. expected object structure
      // {
      //   token: 'eth-address',
      //   address: 'eth-address',
      //     amount: `integer as string`
      // }
      if (version === "2") {
        if (edition.optionalCommissionAccount) {
          const optionalCommissionRate = ethers.BigNumber.from(edition.optionalCommissionRate.toString());
          const singleUnitOfValue = mData.amount_due_to_creators_bn.div(ethers.BigNumber.from('85'));
          const optionalCommissionAmount = singleUnitOfValue.mul(optionalCommissionRate);

          allMerkleTreeNodes.push({
            token,
            address: edition.artistAccount,
            amount: mData.amount_due_to_creators_bn.sub(optionalCommissionAmount).toString()
          });

          allMerkleTreeNodes.push({
            token,
            address: edition.optionalCommissionAccount,
            amount: optionalCommissionAmount.toString()
          });
        } else {
          allMerkleTreeNodes.push({
            token,
            address: edition.artistAccount,
            amount: mData.amount_due_to_creators
          });
        }
      } else {
        if (edition.collective) {
          const {recipients, splits} = edition.collective

          const v3Modulo = ethers.BigNumber.from('10000000')
          const singleUnitOfValue = ethers.BigNumber.from(mData.amount_due_to_creators).div(v3Modulo)

          for(let i = 0; i < recipients.length; i++) {
            allMerkleTreeNodes.push({
              token,
              address: recipients[i],
              amount: singleUnitOfValue.mul(ethers.BigNumber.from(splits[i]))
            });
          }
        } else {
          allMerkleTreeNodes.push({
            token,
            address: edition.artistAccount,
            amount: mData.amount_due_to_creators
          });
        }
      }
    }

    // add platform as a node
    allMerkleTreeNodes.push({
      token,
      address: platformAccount,
      amount: platformCommissionCounter.toString()
    });

    const totalETHInMerkleTreeNodes = allMerkleTreeNodes.reduce((memo, {amount}) => {
      const amountBn = ethers.BigNumber.from(amount)
      return memo.add(amountBn);
    }, ethers.BigNumber.from('0'));

    console.log('Generating merkle tree...');

    console.log('allMerkleTreeNodes', allMerkleTreeNodes.length);

    // some accounts may be in the list twice so reduce them into one node
    const allMerkleTreeNodesReducedObject = allMerkleTreeNodes.reduce((memo, {
      token,
      address,
      amount
    }) => {
      const amountBN = ethers.BigNumber.from(amount);

      if (memo[address]) {
        memo[address] = {
          token,
          address,
          amount: memo[address].amount.add(amountBN),
        };
      } else {
        memo[address] = {
          token,
          address,
          amount: amountBN,
        };
      }

      return memo;
    }, {});

    const allMerkleTreeNodesReduced = _.map(Object.keys(allMerkleTreeNodesReducedObject), key => ({
      ...allMerkleTreeNodesReducedObject[key],
      amount: allMerkleTreeNodesReducedObject[key].amount.toString()
    }));

    console.log('allMerkleTreeNodesReduced', allMerkleTreeNodesReduced.length);

    const merkleTree = parseNodesAndBuildMerkleTree(allMerkleTreeNodesReduced);

    console.log('merkle tree built', merkleTree);

    console.log('totalETHInMerkleTreeNodes', ethers.utils.formatEther(totalETHInMerkleTreeNodes).toString())
    console.log('total ETH in merkle tree', ethers.utils.formatEther(ethers.BigNumber.from(merkleTree.tokenTotal)).toString());

    if (
      !totalETHInMerkleTreeNodes.eq(counter) // ensure nodes that go into tree match up to ETH from opensea events
      || !totalETHInMerkleTreeNodes.eq(ethers.BigNumber.from(merkleTree.tokenTotal)) // ensure nodes that go into tree match up to total ETH calculated from tree generation
    ) {
      throw new Error('Balances dont match up');
    }

    // Generate data
    fs.writeFileSync(`./data/merkletree-${merkleTreeVersion}.json`, JSON.stringify(merkleTree, null, 2));

    // console.log('totalPlatformCommission+totalAmountDueToCreators', ethers.utils.formatEther(totalPlatformCommission.add(totalAmountDueToCreators)).toString())
    // console.log('totalPlatformCommission', ethers.utils.formatEther(totalPlatformCommission).toString());
    // console.log('totalAmountDueToCreators', ethers.utils.formatEther(totalAmountDueToCreators).toString());
  }
);
