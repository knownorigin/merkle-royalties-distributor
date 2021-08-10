const {BN, constants, expectEvent, expectRevert, ether, balance} = require('@openzeppelin/test-helpers');
const {ZERO_ADDRESS} = constants;

const {expect} = require('chai');

const MockERC20 = artifacts.require('MockERC20');
const MerkleVault = artifacts.require('MerkleVault');

const {parseNodesAndBuildMerkleTree} = require('../utils/parse-nodes');

contract('MerkleVault test', function ([deployer, beneficiary, random, ...otherAccounts]) {

  const randomIPFSHash = 'QmPAvE7w498UVmKycmpbefbuvHZtQnLUzohM1vpz3th4vE'

  describe.only('single beneficiary of ETH', () => {
    beforeEach(async () => {
      this.initialBeneficiaryNode = {token: ZERO_ADDRESS, address: beneficiary, amount: ether('0.2').toString()}

      this.merkleTree = parseNodesAndBuildMerkleTree([
        this.initialBeneficiaryNode
      ])

      this.vault = await MerkleVault.new({
        root: this.merkleTree.merkleRoot,
        dataIPFSHash: randomIPFSHash
      })

      // send ETH to the vault
      const [ownerSigner] = await ethers.getSigners();
      await ownerSigner.sendTransaction({
        to: this.vault.address,
        value: ethers.utils.parseEther('0.2')
      });
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
        await this.vault.isPartOfMerkleTree(this.merkleTree.claims[beneficiary].index, ZERO_ADDRESS, beneficiary, this.initialBeneficiaryNode.amount, this.merkleTree.claims[beneficiary].proof)
      ).to.be.true

      // invalid data should return false
      expect(
        await this.vault.isPartOfMerkleTree(this.merkleTree.claims[beneficiary].index, random, beneficiary, this.initialBeneficiaryNode.amount, this.merkleTree.claims[beneficiary].proof)
      ).to.be.false
    })

    it('Beneficiary can claim their ETH', async () => {
      // first unpause contract
      await this.vault.unpauseClaiming()

      // claim the ETH once
      const beneficiaryBalTracker = await balance.tracker(beneficiary)

      const gasPrice = new BN(web3.utils.toWei('1', 'gwei').toString());
      const tx = await this.vault.claim(
        this.merkleTree.claims[beneficiary].index,
        ZERO_ADDRESS,
        this.initialBeneficiaryNode.amount,
        this.merkleTree.claims[beneficiary].proof,
        {from: beneficiary, gasPrice}
      )

      await expectEvent(tx.receipt, 'TokensClaimed', {
        token: ZERO_ADDRESS,
        amount: this.initialBeneficiaryNode.amount
      })

      const gasUsed = new BN(tx.receipt.cumulativeGasUsed);
      const txCost = gasUsed.mul(gasPrice);

      expect(await beneficiaryBalTracker.delta()).to.be.bignumber.equal(ether('0.2').sub(txCost))

      await expectRevert(
        this.vault.claim(
          this.merkleTree.claims[beneficiary].index,
          ZERO_ADDRESS,
          this.initialBeneficiaryNode.amount,
          this.merkleTree.claims[beneficiary].proof,
          {from: beneficiary}
        ),
        "Funds have been claimed"
      )
    })
  })

  describe.only('single beneficiary of ERC20 tokens', () => {
    beforeEach(async () => {
      this.mockERC20 = await MockERC20.new()

      const amountForBeneficiary = ether('2')
      this.initialBeneficiaryNode = {
        token: this.mockERC20.address,
        address: beneficiary,
        amount: amountForBeneficiary.toString() // mock token will also be 18 decimal places
      }

      this.merkleTree = parseNodesAndBuildMerkleTree([
        this.initialBeneficiaryNode
      ])

      this.vault = await MerkleVault.new({
        root: this.merkleTree.merkleRoot,
        dataIPFSHash: randomIPFSHash
      })

      await this.mockERC20.mint(this.vault.address, amountForBeneficiary)

      // unpause the contract
      await this.vault.unpauseClaiming()
    })

    it('Contract deployed as expected', async () => {
      expect(await this.vault.merkleVersion()).to.be.bignumber.equal('1')
      expect(await this.vault.merkleVersionMetadata('1')).to.be.deep.equal({
        0: this.merkleTree.merkleRoot,
        1: randomIPFSHash,
        root: this.merkleTree.merkleRoot,
        dataIPFSHash: randomIPFSHash
      })

      // check that the beneficiary account is part of the tree
      expect(
        await this.vault.isPartOfMerkleTree(this.merkleTree.claims[beneficiary].index, this.mockERC20.address, beneficiary, this.initialBeneficiaryNode.amount, this.merkleTree.claims[beneficiary].proof)
      ).to.be.true

      // invalid data should return false
      expect(
        await this.vault.isPartOfMerkleTree(this.merkleTree.claims[beneficiary].index, random, beneficiary, this.initialBeneficiaryNode.amount, this.merkleTree.claims[beneficiary].proof)
      ).to.be.false
    })

    it('Beneficiary can claim their ERC20 tokens', async () => {
      const beneficiaryBalBefore = await this.mockERC20.balanceOf(beneficiary)

      const tx = await this.vault.claim(
        this.merkleTree.claims[beneficiary].index,
        this.mockERC20.address,
        this.initialBeneficiaryNode.amount,
        this.merkleTree.claims[beneficiary].proof,
        {from: beneficiary}
      )

      await expectEvent(tx.receipt, 'TokensClaimed', {
        token: this.mockERC20.address,
        amount: this.initialBeneficiaryNode.amount
      })

      const beneficiaryBalAfter = await this.mockERC20.balanceOf(beneficiary)

      expect(beneficiaryBalAfter.add(beneficiaryBalBefore)).to.be.bignumber.equal(this.initialBeneficiaryNode.amount)
    })

  })
})
