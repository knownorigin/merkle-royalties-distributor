const _ = require('lodash');
const fs = require('fs');

const {loadLatestVaultMerkleTree} = require('../utils/vault-utils');
const ethers = require('ethers');

task('reconcile', 'Reconcile')
  .addParam('vaultAddress', 'Address of the vault')
  .addParam('fromBlock', 'From Block')
  .addParam('toBlock', 'To Block')
  .setAction(async (taskArgs, hre) => {

    const {vaultAddress, fromBlock, toBlock} = taskArgs;

    const {name: network} = hre.network;
    console.log(`Starting task... Running on network [${network}] - loading vault @ [${vaultAddress}] from [${fromBlock}] to [${toBlock}]`);

    const provider = new ethers.providers.InfuraProvider(network, {
      projectSecret: process.env.INFURA_PROJECT_SECRET,
      projectId: process.env.INFURA_PROJECT_ID,
    });

    const {claims, currentMerkleVersion, vault} = await loadLatestVaultMerkleTree(network, vaultAddress);
    const currentVersionBeneficiaries = Object.keys(claims);
    console.log('Current tree total beneficiaries', currentVersionBeneficiaries.length);

    /////////////////////////////////////////////////////////
    // Work out who has claimed since the last merkel tree //
    /////////////////////////////////////////////////////////

    let tokenClaimedEvents = await vault.queryFilter(
      vault.filters.TokensClaimed(),
      parseInt(fromBlock),
      parseInt(toBlock)
    );

    const claimants = await Promise.all(tokenClaimedEvents.map(async ({transactionHash, args}) => {
      const tx = await provider.getTransaction(transactionHash);
      return {
        address: ethers.utils.getAddress(tx.from),
        token: args.token,
        amount: args.amount,
      };
    }));

    const claimedEther = _.reduce(claimants, (result, data) => {
      return ethers.BigNumber.from(data.amount).add(ethers.BigNumber.from(result));
    }, '0');
    console.log(`Total claimed ETH`, ethers.utils.formatEther(claimedEther));

    const rawClaimantAddress = _.map(_.map(claimants, 'address'), (address) => ethers.utils.getAddress(address));
    const unclaimedBeneficiaries = currentVersionBeneficiaries.filter(beneficiary => {
      return !_.includes(rawClaimantAddress, ethers.utils.getAddress(beneficiary));
    });
    console.log('Number of beneficiaries that have not claimed', unclaimedBeneficiaries.length);

    // for ETH based payments, we encode the token as the zero address in the tree
    const token = '0x0000000000000000000000000000000000000000';

    const additionalMerkleNodesForNextVersion = _.map(unclaimedBeneficiaries, beneficiary => ({
      token,
      address: beneficiary,
      amount: ethers.BigNumber.from(claims[beneficiary].amount).toString()
    }));

    const unclaimedEther = _.reduce(additionalMerkleNodesForNextVersion, (result, data) => {
      return ethers.BigNumber.from(data.amount).add(ethers.BigNumber.from(result));
    }, '0');
    console.log(`Total unclaimed ETH from current tree`, ethers.utils.formatEther(unclaimedEther));

    fs.writeFileSync(`./data/reconcile/merkletree-${currentMerkleVersion}-unclaimed-beneficiaries.json`, JSON.stringify(additionalMerkleNodesForNextVersion, null, 2));

    //////////////////////////////////////////////
    // Work out contract balance since last run //
    //////////////////////////////////////////////

    let ethReceivedEvents = await vault.queryFilter(
      vault.filters.ETHReceived(),
      parseInt(fromBlock),
      parseInt(toBlock)
    );
    console.log('ETH deposits found', ethReceivedEvents.length);

    const eventDate = _.map(ethReceivedEvents, event => ({
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      amount: ethers.BigNumber.from(event.args.amount).toString()
    }));

    const ethDeposited = _.reduce(eventDate, (result, data) => {
      return ethers.BigNumber.from(data.amount).add(ethers.BigNumber.from(result));
    }, '0');
    console.log(`Total ETH deposits`, ethers.utils.formatEther(ethDeposited));

    fs.writeFileSync(`./data/reconcile/merkletree-${currentMerkleVersion}-eth-deposits.json`, JSON.stringify(eventDate, null, 2));

    const currentVaultBalance = await provider.getBalance(vaultAddress);
    console.log(`Unclaimed and new deposited ETH`, ethers.utils.formatEther(unclaimedEther.add(ethDeposited)));
    console.log(`Current vault balance`, ethers.utils.formatEther(currentVaultBalance));
  });
