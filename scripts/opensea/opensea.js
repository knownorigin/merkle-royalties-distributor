const moment = require('moment');
const _ = require('lodash');
const fs = require('fs');
const {kodaV1, abi} = require('koda-contract-tools');
const {ethers, getDefaultProvider} = require('ethers');

const {parseNodesAndBuildMerkleTree} = require('../../utils/parse-nodes');

const {getTokenData} = require('../utils/subgraph.service');
const {getEventsForContract, filterAndMapOpenSeaEthData} = require('../utils/opensea.api');

task('open-sea-events', 'Gets OpenSea sale events between 2 dates for an NFT')
  .addParam('startDate', 'Start Date')
  .addParam('endDate', 'End Date')
  .addParam('platformCommission', 'Of the commission sent to the vault, the percentage that goes to platform')
  .addParam('platformAccount', 'Platform account address that will receive a split of the vault')
  .addParam('merkleTreeVersion', 'The version of the file to pin')
  .addParam('ethPayoutAmount', 'Amount of ETH that was last paid by OpenSea')
  .setAction(async taskArgs => {

      function sumBigNumbers(array, field) {
        return array.reduce((memo, data) => memo.add(data[field]), BigNumber.from('0'));
      }

      const {utils, BigNumber} = ethers;

      const {
        startDate,
        endDate,
        platformCommission,
        platformAccount,
        merkleTreeVersion,
        ethPayoutAmount
      } = taskArgs;

      console.log(`Starting task...`, taskArgs);

      const expectedETH = utils.parseEther(ethPayoutAmount);

      /// ---------------------------------
      /// Gather data on NFT contracts
      /// ---------------------------------

      // Get all events from V1, V2 & V3 sales
      let events = await getEventsForContract(merkleTreeVersion, startDate, endDate);

      // for ETH based payments, we encode the token as the zero address in the tree
      const token = '0x0000000000000000000000000000000000000000';

      let mappedData = filterAndMapOpenSeaEthData(platformCommission, events);

      /// ---------------------------------
      /// Count up royalties & commissions
      /// ---------------------------------

      // Total expected creator commission
      const totalAmountDueToCreators = sumBigNumbers(mappedData, 'amount_due_to_creators_bn');

      // Total expected platform commission (if any)
      const totalPlatformCommission = sumBigNumbers(mappedData, 'platform_commission_bn');

      console.log(`
        Total raw event creator royalties: [${utils.formatEther(totalAmountDueToCreators)}]
        
        Total raw event platform commission: [${utils.formatEther(totalPlatformCommission)}]
        
        Total: [${utils.formatEther(totalAmountDueToCreators.add(totalPlatformCommission))}]
      `);

      /// ------------------------------------------------------------------
      /// Check total events fits within expected window and total
      /// ------------------------------------------------------------------

      let cumulativeEventTotalInEth = totalAmountDueToCreators.add(totalPlatformCommission);
      let platformCommissionCounter = totalPlatformCommission;

      // if the total to creators and platform exceeds the expected amount - try work out why
      const doesNotMatchExpectedEth = totalAmountDueToCreators.add(totalPlatformCommission).gt(expectedETH);
      if (doesNotMatchExpectedEth) {
        console.log(`
          !!!!!! More ETH in events than expected - Filtering out events and dumping to file !!!!!
        `);

        // reset totals
        cumulativeEventTotalInEth = BigNumber.from('0');
        platformCommissionCounter = BigNumber.from('0');

        let filteredEvents = [];

        // recount all events and try and find what event was missing
        mappedData.forEach((mData) => {

          // Total commission for token sale (creators & platform)
          const commissionDueForToken = mData.platform_commission_bn.add(mData.amount_due_to_creators_bn);

          // does the current cumulative eth total + the next layer of commission due push the total over the threshold
          const totalDoesNotExceedExpectedEth = cumulativeEventTotalInEth.add(commissionDueForToken).lte(expectedETH);
          if (totalDoesNotExceedExpectedEth) {
            cumulativeEventTotalInEth = cumulativeEventTotalInEth.add(commissionDueForToken);
            platformCommissionCounter = platformCommissionCounter.add(mData.platform_commission_bn);
            filteredEvents.push(mData);
          }
        });

        const firstEventTimestamp = filteredEvents[0].timestamp;
        const lastEventTimestamp = filteredEvents[filteredEvents.length - 1].timestamp;

        const removedEvents = _.difference(mappedData, filteredEvents);

        // Determine total removed from each part
        const totalRemovesCreatorRoyaltiesBn = sumBigNumbers(removedEvents, 'amount_due_to_creators_bn');
        const totalRemovesCreatorRoyalties = utils.formatEther(totalRemovesCreatorRoyaltiesBn);

        const totalRemovePlatformCommissionBn = sumBigNumbers(removedEvents, 'platform_commission_bn');
        const totalRemovePlatformCommission = utils.formatEther(totalRemovePlatformCommissionBn);

        const totalDifference = totalRemovePlatformCommissionBn.add(totalRemovesCreatorRoyaltiesBn);

        console.log(`
          Total number of events excluded: [${removedEvents.length}]
          
          Total difference found: [${utils.formatEther(totalDifference)}]
          
          Creator royalties [${totalRemovesCreatorRoyalties.toString()}] / platform commission [${totalRemovePlatformCommission.toString()}] 
          
          -----
          
          Range from [${firstEventTimestamp}] To [${lastEventTimestamp}]
          
          New platform commission ETH [${utils.formatEther(platformCommissionCounter.toString())}] 
          
          New cumulative total ETH [${utils.formatEther(cumulativeEventTotalInEth.toString())}]
        `);

        // Write to file for the record
        fs.writeFileSync(`./data/live/removed-${merkleTreeVersion}.json`, JSON.stringify(removedEvents, null, 2));

        mappedData = filteredEvents;
      }

      /// --------------------------------
      /// Build merkle tree
      /// --------------------------------

      console.log(`Looking up platform data for ${mappedData.length} events`);
      const allMerkleTreeNodes = [];
      for (let i = 0; i < mappedData.length; i++) {
        const mData = mappedData[i];

        // is this a v1 token? else go down a different path to process v2 and v3
        if (parseInt(mData.token_id) <= 4500) {

          const kodaV1Contract = new ethers.Contract(
            kodaV1.getKodaV1Address('mainnet'),
            abi.kodaV1,
            getDefaultProvider(1)
        )

          const editionInfo = await kodaV1Contract.editionInfo(mData.token_id);
          console.log('editionInfo._artistAccount ****', editionInfo._artistAccount);

          allMerkleTreeNodes.push({
            token,
            address: editionInfo._artistAccount,
            amount: mData.amount_due_to_creators
          });
        } else {
          // console.log(`Looking up token ID [${mData.token_id}] data - ${mappedData.length - (i + 1)} lookups left`);
          const reqRes = await getTokenData(mData.token_id);

          // check the token is found
          if (!reqRes || !reqRes.tokens || !reqRes.tokens[0]) {
            continue;
          }

          const {edition, version} = reqRes.tokens[0];

          // this must be compliant with utils/parse-nodes.js
          // i.e. expected object structure
          // {
          //   token: 'eth-address',
          //   address: 'eth-address',
          //   amount: `integer as string`
          // }
          if (version === '2') {

            ////////////////////////////
            // Handle V2 dual collabs //
            ////////////////////////////

            if (edition.optionalCommissionAccount) {
              const optionalCommissionRate = BigNumber.from(edition.optionalCommissionRate.toString());
              const singleUnitOfValue = mData.amount_due_to_creators_bn.div(BigNumber.from('85'));
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
              const {recipients, splits} = edition.collective;

              const v3Modulo = BigNumber.from('10000000');
              const singleUnitOfValue = BigNumber.from(mData.amount_due_to_creators).div(v3Modulo);

              for (let i = 0; i < recipients.length; i++) {
                allMerkleTreeNodes.push({
                  token,
                  address: recipients[i],
                  amount: singleUnitOfValue.mul(BigNumber.from(splits[i]))
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
      }

      // add platform as a node
      allMerkleTreeNodes.push({
        token,
        address: platformAccount,
        amount: platformCommissionCounter.toString()
      });

      const totalETHInMerkleTreeNodes = allMerkleTreeNodes.reduce((memo, {amount}) => {
        const amountBn = BigNumber.from(amount);
        return memo.add(amountBn);
      }, BigNumber.from('0'));

      console.log(`Generating merkle tree from [${allMerkleTreeNodes.length}] nodes...`);

      // some accounts may be in the list twice so reduce them into one node
      const allMerkleTreeNodesReducedObject = allMerkleTreeNodes.reduce((memo, {
        token,
        address,
        amount
      }) => {
        const amountBN = BigNumber.from(amount);
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

      const cumulativeCommissionDue = utils.formatEther(totalAmountDueToCreators.add(totalPlatformCommission).toString());

      console.log(`
      --------------------------
      -- Final results output --
      --------------------------
      
      Expected amount: [${utils.formatEther(expectedETH.toString())}]
      
      Total commission in ALL events (creators & platform): [${cumulativeCommissionDue}]
      
      Actual amount counted: [${utils.formatEther(cumulativeEventTotalInEth.toString())}]
      
      Total ETH in merkle tree nodes: [${utils.formatEther(totalETHInMerkleTreeNodes).toString()}]
      
      Total ETH in merkle tree: [${utils.formatEther(BigNumber.from(merkleTree.tokenTotal)).toString()}]
      
      Is total ETH in tree == expected amount?? [${utils.formatEther(expectedETH.toString()) === utils.formatEther(BigNumber.from(merkleTree.tokenTotal)).toString()}]
     
      Total reduced merkle tree nodes: [${allMerkleTreeNodesReduced.length}]
    `);

      if (
        !totalETHInMerkleTreeNodes.eq(cumulativeEventTotalInEth) // ensure nodes that go into tree match up to ETH from opensea events
        || !totalETHInMerkleTreeNodes.eq(BigNumber.from(merkleTree.tokenTotal)) // ensure nodes that go into tree match up to total ETH calculated from tree generation
      ) {
        throw new Error('Balances dont match up');
      }

      // Generate data
      fs.writeFileSync(`./data/live/merkletree-${merkleTreeVersion}.json`, JSON.stringify(merkleTree, null, 2));
    }
  );
