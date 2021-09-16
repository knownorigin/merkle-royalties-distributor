const _ = require('lodash');
const fs = require('fs');

const {parseNodesAndBuildMerkleTree} = require('../../utils/parse-nodes');

const {getTokenData} = require('../utils/subgraph.service');
const {getEventsForContract} = require('../utils/opensea.api');

// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

task("open-sea-events", "Gets OpenSea sale events between 2 dates for an NFT")
.addParam('startDate', 'Start Date')
.addParam('endDate', 'End Date')
.addParam('vaultCommission', "Commission sent to vault from an OpenSea sale")
.addParam('platformCommission', "Of the commission sent to the vault, the percentage that goes to platform")
.addParam('platformAccount', "Platform account address that will receive a split of the vault")
.addParam('merkleTreeVersion', 'The version of the file to pin')
.addParam('ethPayoutAmount', 'Amount of ETH that was last paid by OpenSea')
.setAction(async taskArgs => {

    const {
      startDate,
      endDate,
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

    let events = [
      ...await getEventsForContract(startDate, endDate, KODAV2ContractAddress),
      ...await getEventsForContract(startDate, endDate, KODAV3ContractAddress),
    ];

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
      console.log(`Total number of events excluded: [${mappedData.length - filteredEvents.length}]`)
      console.log(`Event first timestamp [${filteredEvents[0].timestamp}] last timestamp [${filteredEvents[filteredEvents.length-1].timestamp}]`)

      // TODO sum these up and see if the diff matches
      const removedEvents = _.difference(mappedData, filteredEvents);
      fs.writeFileSync(`./data/live/removed-${merkleTreeVersion}.json`, JSON.stringify(removedEvents, null, 2));

      mappedData = filteredEvents
    }

    console.log(`Looking up platform data for ${mappedData.length} events`);
    const allMerkleTreeNodes = [];
    for (let i = 0; i < mappedData.length; i++) {
      const mData = mappedData[i];

      console.log(`Looking up token ID [${mData.token_id}] data - ${mappedData.length - (i + 1)} lookups left`);
      const reqRes = await getTokenData(mData.token_id);

      // check the token is found
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

        ////////////////////////////
        // Handle V2 dual collabs //
        ////////////////////////////

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

        /////////////////////////////////
        // Handle V3 collectives logic //
        /////////////////////////////////

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

    const merkleTree = parseNodesAndBuildMerkleTree(allMerkleTreeNodesReduced);
    // console.log('merkle tree built', merkleTree);

    console.log(`
      Final results output
      --------------------
      
      Expected amount: [${ethers.utils.formatEther(expectedETH.toString())}]
      
      Total in ALL events: [${ethers.utils.formatEther(totalAmountDueToCreators.add(totalPlatformCommission).toString())}]
      
      Actual amount counted: [${ethers.utils.formatEther(counter.toString())}]
      
      Total ETH in merkel tree nodes: [${ethers.utils.formatEther(totalETHInMerkleTreeNodes).toString()}]
      
      Total ETH in merge tree: [${ethers.utils.formatEther(ethers.BigNumber.from(merkleTree.tokenTotal)).toString()}]
     
      Total reduced merkle tree nodes: [${allMerkleTreeNodesReduced.length}]
    `);

  if (
      !totalETHInMerkleTreeNodes.eq(counter) // ensure nodes that go into tree match up to ETH from opensea events
      || !totalETHInMerkleTreeNodes.eq(ethers.BigNumber.from(merkleTree.tokenTotal)) // ensure nodes that go into tree match up to total ETH calculated from tree generation
    ) {
      throw new Error('Balances dont match up');
    }

    // Generate data
    fs.writeFileSync(`./data/live/merkletree-${merkleTreeVersion}.json`, JSON.stringify(merkleTree, null, 2));

    // console.log('totalPlatformCommission+totalAmountDueToCreators', ethers.utils.formatEther(totalPlatformCommission.add(totalAmountDueToCreators)).toString())
    // console.log('totalPlatformCommission', ethers.utils.formatEther(totalPlatformCommission).toString());
    // console.log('totalAmountDueToCreators', ethers.utils.formatEther(totalAmountDueToCreators).toString());
  }
);
