const sleep = async (delay = 1001) => {
  return new Promise(resolve => {
    setTimeout(() => resolve(), delay);
  });
};

module.exports = {
  sleep
};
