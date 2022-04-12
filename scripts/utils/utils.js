const {ethers} = require('ethers');
const {BigNumber} = ethers;

const sleep = async (delay = 1100) => {
  return new Promise(resolve => {
    setTimeout(() => resolve(), delay);
  });
};

function sumBigNumbers(array, field) {
  return array.reduce((memo, data) => memo.add(data[field]), BigNumber.from('0'));
}

module.exports = {
  sleep,
  sumBigNumbers
};
