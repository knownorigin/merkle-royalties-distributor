const sleep = async (delay = 1100) => {
  return new Promise(resolve => {
    setTimeout(() => resolve(), delay);
  });
};

module.exports = {
  sleep
};
