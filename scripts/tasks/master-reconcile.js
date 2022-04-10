const _ = require('lodash');
const ethers = require('ethers');
const {loadVaultInstance} = require('../utils/vault-utils');
const {getEventsForContract, filterAndMapOpenSeaEthData} = require('../utils/opensea.api');
const {sumBigNumbers} = require('../utils/utils');

task('master-reconcile', 'Get total depostisted and claimed')
  .addParam('vaultAddress', 'Address of the vault')
  .addParam('fromBlock', 'From Block')
  .addParam('toBlock', 'To Block')
  .addParam('platformCommission', 'Of the commission sent to the vault, the percentage that goes to platform')
  .addParam('platformAccount', 'Platform account address that will receive a split of the vault')
  .setAction(async (taskArgs, hre) => {
    const {utils, BigNumber} = ethers;
    const {name: network} = hre.network;
    const {vaultAddress, fromBlock, toBlock, platformCommission, platformAccount} = taskArgs;

    console.log(`Starting task... Running on network [${network}] - loading vault @ [${vaultAddress}] from [${fromBlock}] to [${toBlock}]`);

    const {provider, vault} = loadVaultInstance(network, vaultAddress);

    //////////////////////////////////////
    // Get total number of ETH deposits //
    //////////////////////////////////////

    const ethReceivedEvents = await vault.queryFilter(
      vault.filters.ETHReceived(),
      parseInt(fromBlock),
      parseInt(toBlock)
    );
    let totalPayout = ethers.BigNumber.from('0');
    ethReceivedEvents.forEach((event) => {
      const {args} = event;
      console.log(`Found [${ethers.utils.formatEther(args.amount)}] in tx [${event.transactionHash}]`);
      totalPayout = totalPayout.add(args.amount);
    });
    console.log('Total ETH payouts', ethers.utils.formatEther(totalPayout));

    ////////////////////////////////////
    // Get total number of ETH claims //
    ////////////////////////////////////

    let tokenClaimedEvents = await vault.queryFilter(
      vault.filters.TokensClaimed(),
      parseInt(fromBlock),
      parseInt(toBlock)
    );

    let totalClaimed = ethers.BigNumber.from('0');
    const claimants = await Promise.all(tokenClaimedEvents.map(async ({transactionHash, args}) => {
      const tx = await provider.getTransaction(transactionHash);
      totalClaimed = totalPayout.add(args.amount);
      return {
        address: ethers.utils.getAddress(tx.from),
        token: args.token,
        amount: args.amount,
      };
    }));
    console.log('Total ETH payouts', ethers.utils.formatEther(totalClaimed));

    console.log(`
      Unclaimed ETH [${ethers.utils.formatEther(totalPayout.sub(totalClaimed))}] 
    `);

    ///////////////////////////
    // Get all sales from OS //
    ///////////////////////////

    const startDate = (await provider.getBlock(parseInt(fromBlock))).timestamp;
    const endDate = (await provider.getBlock(parseInt(toBlock))).timestamp;

    // Get all events from V1, V2 & V3 sales
    let events = await getEventsForContract(999, startDate, endDate);
    let mappedData = filterAndMapOpenSeaEthData(platformCommission, events);

    // Total expected creator commission
    const totalAmountDueToCreators = sumBigNumbers(mappedData, 'amount_due_to_creators_bn');

    // Total expected platform commission (if any)
    const totalPlatformCommission = sumBigNumbers(mappedData, 'platform_commission_bn');

    console.log(`
        Total raw event creator royalties: [${utils.formatEther(totalAmountDueToCreators)}]
        
        Total raw event platform commission: [${utils.formatEther(totalPlatformCommission)}]
        
        Total: [${utils.formatEther(totalAmountDueToCreators.add(totalPlatformCommission))}]
      `);

  });
