const {BN, constants, expectEvent, expectRevert, ether, balance} = require('@openzeppelin/test-helpers');
const {ZERO_ADDRESS} = constants;

const {expect} = require('chai');

const MerkleVault = artifacts.require('MerkleVault');

const {parseNodesAndBuildMerkleTree} = require('../utils/parse-nodes');

contract('MerkleVault test', function ([deployer, beneficiary, random, ...otherAccounts]) {

  const randomIPFSHash = 'QmPAvE7w498UVmKycmpbefbuvHZtQnLUzohM1vpz3th4vE'
  const initialBeneficiaryNode = {token: ZERO_ADDRESS, address: beneficiary, amount: ether('0.2').toString()}

  beforeEach(async () => {
    this.merkleTree = parseNodesAndBuildMerkleTree([
      initialBeneficiaryNode
    ])

    this.vault = await MerkleVault.new({
      root: this.merkleTree.merkleRoot,
      dataIPFSHash: randomIPFSHash
    })
  })

  it('Contract deployed as expected', async () => {
    expect(await this.vault.merkleVersion()).to.be.bignumber.equal('1')
    expect(await this.vault.merkleVersionMetadata('1')).to.be.deep.equal({
      0: this.merkleTree.merkleRoot,
      1: randomIPFSHash,
      root: this.merkleTree.merkleRoot,
      dataIPFSHash: randomIPFSHash
    })
    expect(await this.vault.paused()).to.be.true

    // check that the beneficiary account is part of the tree
    expect(
      await this.vault.isPartOfMerkleTree(this.merkleTree.claims[beneficiary].index, ZERO_ADDRESS, beneficiary, initialBeneficiaryNode.amount, this.merkleTree.claims[beneficiary].proof)
    ).to.be.true

    // invalid data should return false
    expect(
      await this.vault.isPartOfMerkleTree(this.merkleTree.claims[beneficiary].index, random, beneficiary, initialBeneficiaryNode.amount, this.merkleTree.claims[beneficiary].proof)
    ).to.be.false
  })

  it('Beneficiary can claim their ETH', async () => {
    // first unpause contract
    await this.vault.unpauseClaiming()

    // send ETH to the vault
    const [ownerSigner] = await ethers.getSigners();
    await ownerSigner.sendTransaction({
      to: this.vault.address,
      value: ethers.utils.parseEther('0.2')
    });

    // claim the ETH once
    const beneficiaryBalTracker = await balance.tracker(beneficiary)

    const gasPrice = new BN(web3.utils.toWei('1', 'gwei').toString());
    const tx = await this.vault.claim(
      this.merkleTree.claims[beneficiary].index,
      ZERO_ADDRESS,
      initialBeneficiaryNode.amount,
      this.merkleTree.claims[beneficiary].proof,
      {from: beneficiary, gasPrice}
    )

    await expectEvent(tx.receipt, 'TokensClaimed', {
      token: ZERO_ADDRESS,
      amount: initialBeneficiaryNode.amount
    })

    const gasUsed = new BN(tx.receipt.cumulativeGasUsed);
    const txCost = gasUsed.mul(gasPrice);

    expect(await beneficiaryBalTracker.delta()).to.be.bignumber.equal(ether('0.2').sub(txCost))

    await expectRevert(
      this.vault.claim(
        this.merkleTree.claims[beneficiary].index,
        ZERO_ADDRESS,
        initialBeneficiaryNode.amount,
        this.merkleTree.claims[beneficiary].proof,
        {from: beneficiary}
      ),
      "Funds have been claimed"
    )
  })
})
