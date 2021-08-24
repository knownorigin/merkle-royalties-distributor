require('dotenv').config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-truffle5");
require('solidity-coverage');
require('hardhat-gas-reporter');
require('./scripts/opensea/opensea');
require('./scripts/opensea/pin-merkle-tree-to-ipfs');

const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [`0x${PRIVATE_KEY}`]
    },
  },
  gasReporter: {
    currency: 'USD',
    enabled: (process.env.REPORT_GAS) ? true : false,
    gasPrice: 75,
    showTimeSpent: true,
    showMethodSig: true,
  }
};
