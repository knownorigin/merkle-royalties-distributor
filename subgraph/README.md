## Vault subgraph

For every vault claim and ETH sent to the vault, index the events.

## Queries
Once the subgraph is depoyed, you can undertake the following queries

### Claims
Example query to fetch all claims:
```
{
  claims(where: {isCallerBeneficiary: true}) {
    id
    caller
    isCallerBeneficiary
    token
    amount
    version
  }
}
```

Fields explained:
- `id` - This is the transaction hash for the claim
- `caller` - Account that triggered the claim. Due to the fact you can trigger a claim on behalf of someone, this may not be the beneficiary
- `isCallerBeneficiary` - Whether the caller was in fact the beneficiary of the claim
  - Notice the query had the following where clause: `where: {isCallerBeneficiary: true}`. This allows you to get the list of claims that were done by the beneficiary and the ones that were not done by the beneficiary
  - Given the merkle tree data and list of beneficiaries for a version, you can then filter who claimed from who hasn't
  - On another note: for an ERC20 token claim, by indexing the transfer event you can see who is the recipient of the token (`to` param) which will be the beneficiary where `from` param will be the merkle vault smart contract
- `token` - Token given to beneficiary. This is the zero address if the beneficiary received ETH
- `version` - What version of the merkle tree was active when the claim took place. This ensures that you can filter out beneficiaries that have NOT claimed and add them to future merkle tree versions in order for them to claim

Note: this may not return the full list of claims as subgraph has a paging limit so page as needed.

Example response:
```
{
  "data": {
    "claims": [
      {
        "amount": "157744133201305147070",
        "caller": "0x3768225622d53ffcc1e00eac53a2a870ecd825c8",
        "id": "0x0bf7d668da55f2fb3606fbb7b6963db7adab4e1e8d5baea9572b74ef12f38e29",
        "isCallerBeneficiary": true,
        "token": "0x0000000000000000000000000000000000000000",
        "version": "2"
      }
    ]
  }
}
```

### ETH received

Every time OS send an ETH payment it will be picked up by the subgraph and can be queried as follows:
```
{
  ethreceiveds(first: 1) {
    id
    amount
    from
  }
}
```

example response:
```
{
  "data": {
    "ethreceiveds": [
      {
        "amount": "6495900000000000000",
        "from": "0x0b7a434782792b539623fd72a428838ea4173b22",
        "id": "0x018899a6e5d7bba7eabf83d1e9190676d72d7933a3bf6af8b651cc10fbd7c82f"
      }
    ]
  }
}
```
