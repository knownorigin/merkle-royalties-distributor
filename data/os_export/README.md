## OS Export 05/10/2021

For the first version of the KnownOrigin merkle tree, we used the OpenSea API plus a database export supplied by OpenSea. 

The database export was required to ensure that the amount paid to the vault (`18.5856375 ether`) could be reconciled with the OpenSea API data. The main data point required to do this was the platform commission set on the sale.

Our standard OpenSea script in `scripts/opensea/opensea.js` was tweaked in order to take a JSON to override any platform fee that was not correct.

Given the date range of the pay out (around 23rd 11am - 29th 11:53pm UTC) and the database export, we were able to construct a merkle tree containing the list of artist addresses and amount of commission they are due

The merkle tree data can be inspected here:

`https://gateway.pinata.cloud/ipfs/QmcsxqGEKA6SKo32pvzyt5SoEx9WdVxWXMNArTQRtAnTWR`

and can be verified in the smart contract here:

`https://etherscan.io/address/0x11B0D9AFD49Dc36D86DEa579d0D11771a4f2f54b#readContract`

As said before, this is the first merkle tree version for the contract so you can query the information by specifying this when querying the merkle tree metadata

