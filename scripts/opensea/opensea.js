const _ = require('lodash');
const axios = require('axios');
const {request, gql} = require('graphql-request');
const {parseNodesAndBuildMerkleTree} = require('../../utils/parse-nodes');
const moment = require("moment");

const fs = require('fs');

// todo
// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

// todo - chunk range into days
function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`;
}

task("open-sea-events", "Gets OpenSea sale events between 2 dates for an NFT")
.addParam('nftAddress', 'ETH contract address for the NFT')
.addParam('startDate', 'Start Date')
.addParam('endDate', 'End Date')
  //.addParam('tokenSymbol', "Events will be filtered for payments by this symbol i.e. 'ETH") // todo - enable later
.addParam('vaultCommission', "Commission sent to vault from an OpenSea sale")
.addParam('platformCommission', "Of the commission sent to the vault, the percentage that goes to platform")
.addParam('platformAccount', "Platform account address that will receive a split of the vault")
.addParam('merkleTreeVersion', 'The version of the file to pin')
.setAction(async taskArgs => {
    const {
      nftAddress, // todo - have a KO shell script with this hard coded
      startDate,
      endDate,
      // tokenSymbol,
      vaultCommission,
      platformCommission,
      platformAccount,
      merkleTreeVersion,
    } = taskArgs;

    console.log(`Starting task...`);

    // TODO churn data and determine allocations + sense checks on output

    const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

    console.log('Hitting up OpenSea for some data');

    const oneDayInSeconds = 86400;
    const endDateUnix = parseInt(endDate);
    let currentUnix = moment.unix(parseInt(startDate)).startOf('day').unix();
    let events = [];
    let numOfRequests = 0;
    while (currentUnix <= endDateUnix) {
      console.log(`OpenSea request ${numOfRequests + 1}`);

      const {data} = await axios.get(getOpenSeaUrl(nftAddress, currentUnix, currentUnix + oneDayInSeconds), {
        'X-API-KEY': OPENSEA_API_KEY
      });

      events = _.concat(events, data.asset_events);

      // add one day
      currentUnix += oneDayInSeconds;

      numOfRequests += 1;
    }

    if (currentUnix > endDateUnix && endDateUnix - (currentUnix - oneDayInSeconds) > 0) {
      numOfRequests += 1;
      console.log(`OpenSea request ${numOfRequests + 1}`);

      const {data} = await axios.get(getOpenSeaUrl(nftAddress, currentUnix - oneDayInSeconds, endDateUnix), {
        'X-API-KEY': OPENSEA_API_KEY
      });

      events = _.concat(events, data.asset_events);
    }

    console.log('Filtering data for specific payment token [ETH]');
    const filteredEvents = _.filter(events, (event) => {
      // ensure we filter for the correct payment token and ensure we get back a token ID
      return (event.payment_token.symbol === 'ETH' || event.payment_token.symbol === 'WETH') && event.asset && event.asset.token_id;
    });

    // for ETH based payments, we encode the token as the zero address in the tree
    const token = '0x0000000000000000000000000000000000000000';

    console.log(`Mapping sale data for ${filteredEvents.length} events`);
    const modulo = ethers.BigNumber.from('100000');

    const mappedData = _.map(filteredEvents, ({asset, total_price, created_date}) => {
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
        token_id: asset.token_id
      };
    });

    const totalPlatformCommission = mappedData.reduce((memo, {platform_commission_bn}) => {
      return memo.add(platform_commission_bn);
    }, ethers.BigNumber.from('0'));

    const totalAmountDueToCreators = mappedData.reduce((memo, {amount_due_to_creators_bn}) => {
      return memo.add(amount_due_to_creators_bn);
    }, ethers.BigNumber.from('0'));

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
      }
    }

    // add platform as a node
    allMerkleTreeNodes.push({
      token,
      address: platformAccount,
      amount: totalPlatformCommission.toString()
    });

    const totalETHInMerkleTreeNodes = allMerkleTreeNodes.reduce((memo, {amount}) => {
      const amountBn = ethers.BigNumber.from(amount)
      return memo.add(amountBn);
    }, ethers.BigNumber.from('0'));

    // FIXME FAKE TEST DATA
    // let fakeTestData = [
    //   "0x0f48669b1681d41357eac232f516b77d0c10f0f1", // j
    //   "0x7dec37c03ea5ca2c47ad2509be6abaf8c63cdb39", // d
    //   "0xd9c575163c3fc0948490b02cce19acf8d9ec8427", // l
    //   "0x70482d3bd44fbef402a0cee6d9bea516d12be128", // b
    //   "0x0b6fa76a74fb44a1f6e62ac952cd6b1905c1feb8", // e
    //   "0x401cbf2194d35d078c0bcdae4bea42275483ab5f", // a
    //   "0xd514f2065fde42a02c73c913735e8e5a2fcc085e", // c
    //   "0x681a7040477be268a4b9a02c5e8263fd9febf0a9", // Liam
    //   "0x4D20F13e70320e9C11328277F2Cc0dC235A74F27", // acc 1
    //   "0xbFcF4088772bd56d45d2daBA4e86D410d6076775", // darkness
    //   "0xcce99f546d60541E85D006FCB9F5510A1d100Ac9", // bhm
    //   "0xA9d8b169783100639Bb137eC09f7277DC7948760", // vinc 1
    //   "0x4a429c0CF1e23C55C4d5249a3d485Cd5cB5683D0", // vinc 2
    // ];
    //
    // fakeTestData.forEach((testAddress, index) => {
    //   allMerkleTreeNodes.push({
    //     token,
    //     address: testAddress,
    //     amount: index % 2 === 0 ? '100000000000000000' : '246800000000000000',
    //   });
    // });

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
    console.log('totalPlatformCommission+totalAmountDueToCreators', ethers.utils.formatEther(totalPlatformCommission.add(totalAmountDueToCreators)).toString())
    console.log('total ETH in merkle tree', ethers.utils.formatEther(ethers.BigNumber.from(merkleTree.tokenTotal)).toString());

    if (
      !totalETHInMerkleTreeNodes.eq(totalPlatformCommission.add(totalAmountDueToCreators)) // ensure nodes that go into tree match up to ETH from opensea events
      || !totalETHInMerkleTreeNodes.eq(ethers.BigNumber.from(merkleTree.tokenTotal)) // ensure nodes that go into tree match up to total ETH calculated from tree generation
    ) {
      throw new Error('Balances dont match up');
    }

    // Generate data
    fs.writeFileSync(`./data/merkletree-${merkleTreeVersion}.json`, JSON.stringify(merkleTree, null, 2));

    console.log('totalPlatformCommission', ethers.utils.formatEther(totalPlatformCommission).toString());
    console.log('totalAmountDueToCreators', ethers.utils.formatEther(totalAmountDueToCreators).toString());
  }
);
