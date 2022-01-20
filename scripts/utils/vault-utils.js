const vaultABI = require('../../artifacts/contracts/MerkleVault.sol/MerkleVault.json').abi;
const axios = require('axios');
const ethers = require('ethers');

module.exports = {

  loadLatestVaultMerkleTree: async (network, vaultAddress) => {

    const provider = new ethers.providers.InfuraProvider(network, {
        projectSecret: process.env.INFURA_PROJECT_SECRET,
        projectId: process.env.INFURA_PROJECT_ID,
    });

    const vault = new ethers.Contract(
      vaultAddress,
      vaultABI,
      provider
    );

    const currentMerkleVersion = await vault.merkleVersion();
    console.log('Found current merkle tree version', currentMerkleVersion.toString());

    const {dataIPFSHash} = await vault.merkleVersionMetadata(currentMerkleVersion);
    console.log('IPFS hosted tree data', dataIPFSHash);

    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${dataIPFSHash}`;

    const {data} = await axios.get(ipfsUrl);
    const {claims} = data;

    return {claims, currentMerkleVersion, vault};
  }
};
