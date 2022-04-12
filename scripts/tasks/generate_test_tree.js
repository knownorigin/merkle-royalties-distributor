const prompt = require('prompt-sync')();
const _ = require('lodash');
const {parseNodesAndBuildMerkleTree} = require('../../utils/parse-nodes');
const fs = require('fs');

const pinataSDK = require('@pinata/sdk');
const pinata = pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_API_SECRET);


task('generate-test-data', 'Generate a new set of test merkle proofs for rinkeby')
  .setAction(async (taskArgs) => {

      const merkleTreeVersion = prompt('The version of the file to pin? ');

      // for ETH based payments, we encode the token as the zero address in the tree
      const token = '0x0000000000000000000000000000000000000000';

      const allMerkleTreeNodes = [];

      // FAKE TEST DATA
      let fakeTestData = [
        '0x3f8C962eb167aD2f80C72b5F933511CcDF0719D4', // KO
        '0x0f48669b1681d41357eac232f516b77d0c10f0f1', // j
        '0x7dec37c03ea5ca2c47ad2509be6abaf8c63cdb39', // d
        '0xd9c575163c3fc0948490b02cce19acf8d9ec8427', // l
        '0x70482d3bd44fbef402a0cee6d9bea516d12be128', // b
        '0x0b6fa76a74fb44a1f6e62ac952cd6b1905c1feb8', // e
        '0x401cbf2194d35d078c0bcdae4bea42275483ab5f', // a
        '0xd514f2065fde42a02c73c913735e8e5a2fcc085e', // c
        '0x681a7040477be268a4b9a02c5e8263fd9febf0a9', // Liam
        '0x4D20F13e70320e9C11328277F2Cc0dC235A74F27', // acc 1
        '0xbFcF4088772bd56d45d2daBA4e86D410d6076775', // darkness
        '0xcce99f546d60541E85D006FCB9F5510A1d100Ac9', // bhm
        '0xA9d8b169783100639Bb137eC09f7277DC7948760', // vinc 1
        '0x4a429c0CF1e23C55C4d5249a3d485Cd5cB5683D0', // vinc 2
      ];

      fakeTestData.forEach((testAddress, index) => {
        allMerkleTreeNodes.push({
          token,
          address: testAddress,
          amount: index % 2 === 0 ? '100000000000000000' : '246800000000000000',
        });
      });

      console.log('Generating merkle tree...');

      console.log('allMerkleTreeNodes', allMerkleTreeNodes.length);

      // some accounts may be in the list twice so reduce them into one node
      const allMerkleTreeNodesReducedObject = allMerkleTreeNodes.reduce((memo, {token, address, amount}) => {
        const amountBN = ethers.BigNumber.from(amount);
        if (memo[address]) {
          memo[address] = {
            token,
            address,
            amount: memo[address].amount.add(amountBN),
          };
        } else {
          memo[address] = {
            token,
            address,
            amount: amountBN,
          };
        }
        return memo;
      }, {});

      const allMerkleTreeNodesReduced = _.map(Object.keys(allMerkleTreeNodesReducedObject), key => ({
        ...allMerkleTreeNodesReducedObject[key],
        amount: allMerkleTreeNodesReducedObject[key].amount.toString()
      }));

      console.log('allMerkleTreeNodesReduced', allMerkleTreeNodesReduced.length);

      const merkleTree = parseNodesAndBuildMerkleTree(allMerkleTreeNodesReduced);

      console.log('merkle tree built', merkleTree);

      const path = `./data/test/merkletree-${merkleTreeVersion}.json`;
      fs.writeFileSync(path, JSON.stringify(merkleTree, null, 2));

      const results = await pinata.pinFileToIPFS(fs.createReadStream(path));
      console.log(`Pinning IPFS merkle tree, ipfs hash: ${results.IpfsHash}`);
    }
  );
