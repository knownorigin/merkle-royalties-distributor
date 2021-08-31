const prompt = require('prompt-sync')();

const MerkleVault = require('../../artifacts/contracts/MerkleVault.sol/MerkleVault.json');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying vault with the account:', await deployer.getAddress());

  const merkleVaultAddress = prompt('MerkleVault address? ');
  const ipfsHash = prompt('IPFS hash? ');
  const merkleRoot = prompt('Merkle root? ');

  console.log('\nSupplied merkleVaultAddress: ', merkleVaultAddress);

  prompt(`\nIf happy, hit enter...`);

  const merkleVaultDeployment = new ethers.Contract(
    merkleVaultAddress,
    MerkleVault.abi,
    deployer
  );

  // Wait for deployment
  await merkleVaultDeployment.deployed();

  const pausedState = await merkleVaultDeployment.paused();
  console.log('paused state', pausedState);

  if (!pausedState) {
    console.log('pausing contract');
    await merkleVaultDeployment.pauseClaiming();
  }

  await merkleVaultDeployment.updateMerkleTree({
    root: merkleRoot,
    dataIPFSHash: ipfsHash
  });
  console.log('updated root and hash');

  await merkleVaultDeployment.unpauseClaiming();
  console.log('unpausing contract');

  console.log('MerkleVault root and ipfs updated');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
