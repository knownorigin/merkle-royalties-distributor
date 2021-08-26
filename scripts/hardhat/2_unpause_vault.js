const prompt = require('prompt-sync')();

const MerkleVault = require('../../artifacts/contracts/MerkleVault.sol/MerkleVault.json');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying vault with the account:', await deployer.getAddress());

  const merkleVaultAddress = prompt('MerkleValut address? ');


  console.log('\nSupplied merkleVaultAddress: ', merkleVaultAddress);

  prompt(`\nIf happy, hit enter...`);

  const merkleVaultDeployment = new ethers.Contract(
    merkleVaultAddress,
    MerkleVault.abi,
    deployer
  );

  // Wait for deployment
  await merkleVaultDeployment.deployed();

  await merkleVaultDeployment.unpauseClaiming();

  console.log('MerkleVault unpaused');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
