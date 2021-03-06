# see opensea.js for breakdown of params and meaning

# First run - initiated the process
#yarn open-sea-events \
#  --start-date '1632394800' \
#  --end-date '1639398306' \
#  --vault-commission 12.5 \
#  --platform-commission 2.5 \
#  --platform-account '0xde9e5eE9E7cD43399969Cfb1C0E5596778c6464F' \
#  --merkle-tree-version "2" \
#  --eth-payout-amount "172.0906685"

# Second run --from-block 13817013 --to-block 13981749
#yarn open-sea-events \
#  --start-date '1639484760' \
#  --end-date '1642656560' \
#  --platform-commission 2.5 \
#  --platform-account '0xde9e5eE9E7cD43399969Cfb1C0E5596778c6464F' \
#  --merkle-tree-version "3" \
#  --eth-payout-amount "28.921175"

# Third run
yarn open-sea-events \
  --from-block 14040539 \
  --to-block 14560763 \
  --platform-commission 2.5 \
  --platform-account '0xde9e5eE9E7cD43399969Cfb1C0E5596778c6464F' \
  --merkle-tree-version "4" \
  --eth-payout-amount "20.881522499999999988"
