'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.default = void 0;

var _merkleTree = _interopRequireDefault(require('./merkle-tree'));

var _ethers = require('ethers');

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}

class BalanceTree {
  constructor(nodes) {
    this.tree = new _merkleTree.default(nodes.map(({
                                                        token,
                                                        account,
                                                        amount
                                                      }, index) => {
      return BalanceTree.toNode(index, token, account, amount);
    }));
  }

  static verifyProof(index, token, account, amount, proof, root) {
    let pair = BalanceTree.toNode(index, token, account, amount);

    for (const item of proof) {
      pair = _merkleTree.default.combinedHash(pair, item);
    }

    return pair.equals(root);
  } // keccak256(abi.encode(index, token, account, amount))


  static toNode(index, token, account, amount) {
    return Buffer.from(
      _ethers.utils.solidityKeccak256(
        ['uint256', 'address', 'address', 'uint256'],
        [index, token, account, amount]).substr(2),
      'hex'
    );
  }

  getHexRoot() {
    return this.tree.getHexRoot();
  } // returns the hex bytes32 values of the proof


  getProof(index, token, account, amount) {
    return this.tree.getHexProof(BalanceTree.toNode(index, token, account, amount));
  }

}

exports.default = BalanceTree;
