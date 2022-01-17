'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.parseNodesAndBuildMerkleTree = parseNodesAndBuildMerkleTree;

var _ethers = require('ethers');

var _balanceTree = _interopRequireDefault(require('./balance-tree'));

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}

const {
  isAddress,
  getAddress
} = _ethers.utils; // This is the blob that gets distributed and pinned to IPFS.
// It is completely sufficient for recreating the entire merkle tree.
// Anyone can verify that all air drops are included in the tree,
// and the tree has no additional distributions.

function parseNodesAndBuildMerkleTree(nodes) {
  // expected object structure
  // {
  //   token: 'eth-address',
  //   address: 'eth-address',
  //     amount: `integer`
  // }

  const dataByAddress = nodes.reduce((memo, {
    token,
    address: account,
    amount
  }) => {
    if (!isAddress(account)) {
      throw new Error(`Found invalid address: ${account}`);
    }

    if (!isAddress(token)) {
      throw new Error(`Found invalid token address: ${token}`);
    }

    const checksummedAddress = getAddress(account);
    if (memo[checksummedAddress]) {
      throw new Error(`Duplicate address: ${checksummedAddress}`);
    }

    const amountBN = _ethers.BigNumber.from(amount);

    if (amountBN.lte(0)) {
      throw new Error(`Invalid amount for account: ${checksummedAddress}`);
    }

    memo[checksummedAddress] = {
      token: token,
      amount: amountBN,
    };
    return memo;
  }, {});
  const sortedAddresses = Object.keys(dataByAddress).sort(); // construct a tree

  const tree = new _balanceTree.default(sortedAddresses.map(address => ({
    token: dataByAddress[address].token,
    account: address,
    amount: dataByAddress[address].amount
  }))); // generate claims

  const claims = sortedAddresses.reduce((memo, address, index) => {
    const {
      token,
      amount
    } = dataByAddress[address];

    memo[address] = {
      index,
      amount: amount.toHexString(),
      proof: tree.getProof(index, token, address, amount)
    };

    return memo;
  }, {});
  const tokenTotal = sortedAddresses.reduce((memo, key) => memo.add(dataByAddress[key].amount), _ethers.BigNumber.from(0));
  return {
    merkleRoot: tree.getHexRoot(),
    tokenTotal: tokenTotal.toHexString(),
    claims
  };
}
