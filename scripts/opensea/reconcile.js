const _ = require('lodash');
const axios = require('axios');
const fs = require('fs');
const vaultABI = require('../../artifacts/contracts/MerkleVault.sol/MerkleVault.json').abi;

task('reconcile', 'Reconcile')
  .addParam('vaultAddress', 'Address of the vault')
  .addParam('fromBlock', 'From Block')
  .addParam('toBlock', 'To Block')
  .setAction(async (taskArgs, hre) => {
    const {vaultAddress, fromBlock, toBlock} = taskArgs;
    const {name: network} = hre.network;
    console.log(`Starting task... Running on network [${network}] - loading vault @ [${vaultAddress}] from [${fromBlock}] to [${toBlock}]`);

    const provider = ethers.providers.getDefaultProvider(network, {infura: process.env.INFURA_PROJECT_ID});

    const vault = new ethers.Contract(
      vaultAddress,
      vaultABI,
      provider
    );

    const currentMerkleVersion = await vault.merkleVersion();
    console.log('Found current merkle version', currentMerkleVersion);

    const {dataIPFSHash} = await vault.merkleVersionMetadata(currentMerkleVersion);
    console.log('IPFS hosted tree data', dataIPFSHash);

    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${dataIPFSHash}`;

    const {data} = await axios.get(ipfsUrl);
    const {claims} = data;
    const beneficiaries = Object.keys(claims);

    console.log('Current tree total beneficiaries', beneficiaries.length);

    /////////////////////////////////////////////////////////
    // Work out who has claimed since the last merkel tree //
    /////////////////////////////////////////////////////////

    let tokenClaimedEvents = await vault.queryFilter(
      vault.filters.TokensClaimed(),
      parseInt(fromBlock),
      parseInt(toBlock)
    );

    const claimants = await Promise.all(tokenClaimedEvents.map(async ({transactionHash}) => {
      const tx = await provider.getTransaction(transactionHash);
      return ethers.utils.getAddress(tx.from);
    }));

    console.log('Number of claimants from current tree', claimants.length);
    const unclaimedBeneficiaries = beneficiaries.filter(beneficiary => {
      return !_.includes(claimants, beneficiary);
    });

    console.log('Number of beneficiaries that have not claimed', unclaimedBeneficiaries.length);

    // for ETH based payments, we encode the token as the zero address in the tree
    const token = '0x0000000000000000000000000000000000000000';

    const additionalMerkleNodesForNextVersion = _.map(unclaimedBeneficiaries, beneficiary => ({
      token,
      address: beneficiary,
      amount: ethers.BigNumber.from(claims[beneficiary].amount).toString()
    }));

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

  });
