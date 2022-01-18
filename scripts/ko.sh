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
yarn open-sea-events \
  --start-date '1639612800' \
  --end-date '1641871260' \
  --platform-commission 2.5 \
  --platform-account '0xde9e5eE9E7cD43399969Cfb1C0E5596778c6464F' \
  --merkle-tree-version "3" \
  --eth-payout-amount "16.349575"
