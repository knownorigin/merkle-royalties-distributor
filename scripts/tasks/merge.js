const fs = require('fs');
const {ethers} = require('ethers');
const {utils, BigNumber} = ethers;

const { parseNodesAndBuildMerkleTree } = require('../../utils/parse-nodes');


task('merge', 'Merge merkle tree nodes and generate a merkle tree')
  .addParam('merkleVersion', 'Merkle version number')
  .addParam('vaultVersion', 'Merkle vault version number')
  .setAction(async (taskArgs, hre) => {

    const {merkleVersion, vaultVersion} = taskArgs;

    const liveNodes = JSON.parse(fs.readFileSync(`./data/live/merkletree-nodes-${merkleVersion}.json`, {encoding: 'utf-8'}));
    const unclaimedNodes = JSON.parse(fs.readFileSync(`./data/reconcile/merkletree-${vaultVersion}-unclaimed-beneficiaries.json`, {encoding: 'utf-8'}));

    console.log('Number of new nodes to add', liveNodes.length)
    console.log('Number of unclaimed nodes to add', unclaimedNodes.length)

    const mergedNodes = [
      ...liveNodes,
      ...unclaimedNodes
    ]

    console.log('Generating new tree...')

    const merkleTree = parseNodesAndBuildMerkleTree(mergedNodes);

    console.log(
      `
        Total ETH in merkle tree: [${utils.formatEther(BigNumber.from(merkleTree.tokenTotal)).toString()}]
      `
    )

    fs.writeFileSync(`./data/live/merged-merkletree-${merkleVersion}.json`, JSON.stringify(merkleTree, null, 2));
  })
