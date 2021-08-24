const _ = require('lodash');

const fs = require('fs');

const pinataSDK = require('@pinata/sdk');
const pinata = pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_API_SECRET);

task("pin-merkle-tree-to-ipfs", "Pins the merkle tree from file to IPFS via pinata")
  .addParam('merkleTreeVersion', 'The version of the file to pin')
  .setAction(async taskArgs => {
      const {
        merkleTreeVersion
      } = taskArgs;

      console.log(`Starting task...`);
      console.log(`Version`, merkleTreeVersion);

      const results = await pinata.pinFileToIPFS(fs.createReadStream(`./data/merkletree-${merkleTreeVersion}.json`));
      console.log(`Pinning IPFS merkle tree, ipfs hash: ${results.IpfsHash}`);
    }
  );
