import {
  TokensClaimed,
  ETHReceived as ETHReceivedEvent,
  MerkleVault as MerkleVaultContract
} from "../generated/MerkleVault/MerkleVault"

import {
  Claim,
  ETHReceived
} from "../generated/schema"

export function handleTokensClaimed(event: TokensClaimed): void {
  let contractInstance = MerkleVaultContract.bind(event.address)

  let claim = new Claim(event.transaction.hash.toHexString())
  claim.caller = event.transaction.from
  claim.token = event.params.token
  claim.amount = event.params.amount

  let merkleVersion = contractInstance.merkleVersion()

  // due to `claimFor` method and missing event param, we cannot tell if caller is beneficiary or agent on behalf of beneficiary triggering tx
  // for now, assume everyone is claiming their own tokens and use this to sense check that
  claim.isCallerBeneficiary = contractInstance.fundsClaimed(event.transaction.from, merkleVersion)

  claim.version = merkleVersion
  claim.save()
}

export function handleETHReceived(event: ETHReceivedEvent): void {
  let ethReceived = new ETHReceived(event.transaction.hash.toHexString())
  ethReceived.amount = event.params.amount
  ethReceived.from = event.transaction.from
  ethReceived.save()
}
