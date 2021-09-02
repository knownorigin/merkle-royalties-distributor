const _ = require('lodash')
const axios = require('axios')
const fs = require('fs');
const vaultABI = require('../../artifacts/contracts/MerkleVault.sol/MerkleVault.json').abi;

task("reconcile", "Reconcile")
  .addParam('vaultAddress', 'Address of the vault')
  //.addParam('fromBlock', 'From Block')
  //.addParam('toBlock', 'To Block')
  .setAction(async (taskArgs, hre) => {
    const {
      vaultAddress,
      //fromBlock,
      //toBlock
    } = taskArgs

    console.log(`Starting task...`);

    const {name: network} = hre.network;
    console.log(`Running on network [${network}]`);

    const [deployer] = await ethers.getSigners()

    const vault = new ethers.Contract(
      vaultAddress,
      vaultABI,
      deployer
    )

    const currentMerkleVersion = await vault.merkleVersion()
    const {
      dataIPFSHash
    } = await vault.merkleVersionMetadata(currentMerkleVersion)

    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${dataIPFSHash}`

    const {data} = await axios.get(ipfsUrl)
    const {claims} = data
    const beneficiaries = Object.keys(claims)

    console.log('Current tree total beneficiaries', beneficiaries.length)

    let eventFilter = vault.filters.TokensClaimed()
    let events = await vault.queryFilter(eventFilter) // todo pass in to and from block

    const provider = ethers.providers.getDefaultProvider(network)

    const claimants = await Promise.all(events.map(async ({transactionHash}) => {
      const tx = await provider.getTransaction(transactionHash)
      return ethers.utils.getAddress(tx.from)
    }))

    console.log('Number of claimants from current tree', claimants.length)
    const unclaimedBeneficiaries = beneficiaries.filter(beneficiary => {
      return !_.includes(claimants, beneficiary)
    })

    console.log('Number of beneficiaries that have not claimed', unclaimedBeneficiaries.length)

    // for ETH based payments, we encode the token as the zero address in the tree
    const token = '0x0000000000000000000000000000000000000000';

    const additionalMerkleNodesForNextVersion = _.map(unclaimedBeneficiaries, beneficiary => ({
      token,
      address: beneficiary,
      amount: ethers.BigNumber.from(claims[beneficiary].amount).toString()
    }))

    fs.writeFileSync(`./data/merkletree-${currentMerkleVersion}-unclaimed-beneficiaries.json`, JSON.stringify(additionalMerkleNodesForNextVersion, null, 2));
  })
