const prompt = require('prompt-sync')();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying vault with the account:', await deployer.getAddress());

  prompt(`\nIf happy, hit enter...`);

  const VaultFactory = await ethers.getContractFactory('MerkleVault');
  const vault = await VaultFactory.deploy();

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
