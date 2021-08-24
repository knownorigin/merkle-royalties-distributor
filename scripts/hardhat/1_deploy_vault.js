const prompt = require('prompt-sync')();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying vault with the account:', await deployer.getAddress());

  const merkleRoot = prompt('Merkle root of the initial tree? ');
  const dataIPFSHash = prompt('Tree data IPFS hash? ');

  console.log('\nSupplied merkle root: ', merkleRoot);
  console.log('\nIPFS data hash: ', dataIPFSHash);

  prompt(`\nIf happy, hit enter...`);

  const VaultFactory = await ethers.getContractFactory('MerkleVault');
  const vault = await VaultFactory.deploy({
    root: merkleRoot,
    dataIPFSHash
  });

  console.log('Deploying...');

  // Wait for deployment
  await vault.deployed();

  console.log('Vault deployed at', vault.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
