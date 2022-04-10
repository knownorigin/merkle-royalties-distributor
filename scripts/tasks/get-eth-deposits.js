const _ = require('lodash');
const ethers = require('ethers');
const {loadVaultInstance} = require('../utils/vault-utils');

task('get-eth-deposits', 'Scrape all ETH deposits from the vault')
  .addParam('vaultAddress', 'Address of the vault')
  .addParam('fromBlock', 'From Block')
  .addParam('toBlock', 'To Block')
  .setAction(async (taskArgs, hre) => {

    const {vaultAddress, fromBlock, toBlock} = taskArgs;
    const {name: network} = hre.network;
    console.log(`Starting task... Running on network [${network}] - loading vault @ [${vaultAddress}] from [${fromBlock}] to [${toBlock}]`);

    const {provider, vault} = loadVaultInstance(network, vaultAddress);

    const ethReceivedEvents = await vault.queryFilter(
      vault.filters.ETHReceived(),
      parseInt(fromBlock),
      parseInt(toBlock)
    );

    // console.log(ethReceivedEvents);

    let totalPayout = ethers.BigNumber.from('0');

    ethReceivedEvents.forEach((event) => {
      const {args} = event;
      console.log(`Found [${ethers.utils.formatEther(args.amount)}] in tx [${event.transactionHash}]`);
      totalPayout = totalPayout.add(args.amount);
    });

    console.log('Total ETH payouts', ethers.utils.formatEther(totalPayout));
  });
