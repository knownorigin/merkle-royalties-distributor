const _ = require('lodash');
const axios = require('axios');
const { request, gql } = require('graphql-request')
const { parseNodesAndBuildMerkleTree } = require('../../utils/parse-nodes')
const _ethers = require("ethers");

// todo
// my understanding is that we have to work this out
// open sea always take 2.5 commission so any further commission taken goes to the vault to be further split
function getFullCommissionTakenFromOpenSeaSale(vaultCommission) {
  return vaultCommission + 2.5;
}

// todo - chunk range into days
function getOpenSeaUrl(nftAddress, startDate, endDate, limit = 300) {
  return `https://api.opensea.io/api/v1/events?asset_contract_address=${nftAddress}&event_type=successful&only_opensea=true&occurred_after=${startDate}&occurred_before=${endDate}&limit=${limit}`
}

task("open-sea-events", "Gets OpenSea sale events between 2 dates for an NFT")
  .addParam('nftAddress', 'ETH contract address for the NFT')
  .addParam('startDate', 'Start Date')
  .addParam('endDate', 'End Date')
  // todo - enable later
  //.addParam('tokenSymbol', "Events will be filtered for payments by this symbol i.e. 'ETH")
  .addParam('vaultCommission', "Commission sent to vault from an OpenSea sale")
  .addParam('platformCommission', "Of the commission sent to the vault, the percentage that goes to platform")
  .setAction(async taskArgs => {
    const {
      nftAddress, // todo - have a KO shell script with this hard coded
      startDate,
      endDate,
      // tokenSymbol,
      vaultCommission,
      platformCommission
    } = taskArgs

    console.log(`Starting task...`)

    // TODO get data per day with 300 limit
    // TODO gather data and dump to file
    // TODO churn data and determine allocations + sense checks on output
    // TODO churn data and build trie

    const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY

    console.log('Hitting up OpenSea for some data')
    const {data} = await axios.get(getOpenSeaUrl(nftAddress, startDate, endDate), {
      'X-API-KEY': OPENSEA_API_KEY
    })

    console.log('Filtering data for specific payment token [ETH]')
    const filteredEvents = _.filter(data.asset_events, (event) => {
      // ensure we filter for the correct payment token and ensure we get back a token ID
      return (event.payment_token.symbol === 'ETH' || event.payment_token.symbol === 'WETH') && event.asset && event.asset.token_id;
    });

    // for ETH based payments, we encode the token as the zero address in the tree
    const token = '0x0000000000000000000000000000000000000000'

    const transactionHashes = _.map(filteredEvents, 'transaction.transaction_hash');

    console.log(`Mapping sale data for ${filteredEvents.length} events`)
    const modulo = ethers.BigNumber.from('100000');

    const mappedData = _.map(filteredEvents, ({asset, total_price, created_date}) => {
      const totalPriceBn = ethers.BigNumber.from(total_price)
      const vaultCommissionScaledBn = ethers.BigNumber.from((parseFloat(vaultCommission) * 1000).toString());
      const platformCommissionScaledBn = ethers.BigNumber.from((parseFloat(platformCommission) * 1000).toString());
      const vault_commission = totalPriceBn.div(modulo).mul(vaultCommissionScaledBn)
      const platform_commission = vault_commission.div(modulo).mul(platformCommissionScaledBn)

      const amount_due_to_creators = vault_commission.sub(platform_commission)

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
      }
    });

    const totalPlatformCommission = mappedData.reduce((memo, {platform_commission_bn}) => {
      return memo.add(platform_commission_bn);
    }, ethers.BigNumber.from('0'));

    console.log(`Looking up platform data for ${mappedData.length} events`)
    const allMerkleTreeNodes = []
    for(let i = 0; i < mappedData.length; i++) {
      console.log(`${mappedData.length - (i+1)} lookups left`)
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
      `

      const mData = mappedData[i]

      const reqRes = await request(
        'https://api.thegraph.com/subgraphs/name/knownorigin/known-origin',
        koLookupQuery,
        {
          id: mData.token_id
        }
      )

      if (!reqRes || !reqRes.tokens || !reqRes.tokens[0]) continue;

      const {id, edition, version} = reqRes.tokens[0]

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
          const singleUnitOfValue = mData.amount_due_to_creators_bn.div(ethers.BigNumber.from('85'))
          const optionalCommissionAmount = singleUnitOfValue.mul(optionalCommissionRate)

          allMerkleTreeNodes.push({
            token,
            address: edition.artistAccount,
            amount: mData.amount_due_to_creators_bn.sub(optionalCommissionAmount).toString()
          })

          allMerkleTreeNodes.push({
            token,
            address: edition.optionalCommissionAccount,
            amount: optionalCommissionAmount.toString()
          })
        }
      } else {
        allMerkleTreeNodes.push({
          token,
          address: edition.artistAccount,
          amount: mData.amount_due_to_creators
        })
      }
    }

    // add platform as a node
    // todo - get platform address as a param
    const platformAddress = '0xD677AEd0965AC9B54e709F01A99cEcA205aebC4B'
    allMerkleTreeNodes.push({
      token,
      address: platformAddress,
      amount: totalPlatformCommission.toString()
    })

    console.log('Generating merkle tree...')

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
        }
      } else {
        memo[address] = {
          token,
          address,
          amount: amountBN,
        }
      }

      return memo;
    }, {});

    const allMerkleTreeNodesReduced = _.map(Object.keys(allMerkleTreeNodesReducedObject), key => ({
      ...allMerkleTreeNodesReducedObject[key],
      amount: allMerkleTreeNodesReducedObject[key].amount.toString()
    }))

    const merkleTree = parseNodesAndBuildMerkleTree(allMerkleTreeNodesReduced)

    console.log('merkle tree built', merkleTree)
    console.log('total ETH in merkle tree', ethers.BigNumber.from(merkleTree.tokenTotal).toString())
  })
