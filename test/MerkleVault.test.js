const {BN, constants, expectEvent, expectRevert, ether, balance} = require('@openzeppelin/test-helpers');
const {ZERO_ADDRESS} = constants;

const {expect} = require('chai');

const MockERC20 = artifacts.require('MockERC20');
const MerkleVault = artifacts.require('MerkleVault');

const {parseNodesAndBuildMerkleTree} = require('../utils/parse-nodes');

contract('MerkleVault test', function ([_, random, beneficiary, beneficiary2, beneficiary3, beneficiary4, beneficiary5, ...otherAccounts]) {

  const randomIPFSHash = 'QmPAvE7w498UVmKycmpbefbuvHZtQnLUzohM1vpz3th4vE'

  describe('single beneficiary of ETH', () => {
    beforeEach(async () => {
      // zero address means a claim to ETH
      this.initialBeneficiaryNode = {token: ZERO_ADDRESS, address: beneficiary, amount: ether('0.2').toString()}

      this.merkleTree = parseNodesAndBuildMerkleTree([
        this.initialBeneficiaryNode
      ])

      this.vault = await MerkleVault.new()

      await this.vault.updateMerkleTree({
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

  describe('single beneficiary of ERC20 tokens', () => {
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

      this.vault = await MerkleVault.new()

      await this.vault.updateMerkleTree({
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

  describe('multiple ETH beneficiaries', () => {
    const token = ZERO_ADDRESS // zero address means a claim to ETH
    const beneficiaryNode = {token, address: beneficiary, amount: ether('0.2').toString()}
    const beneficiary2Node = {token, address: beneficiary2, amount: ether('0.43').toString()}
    const beneficiary3Node = {token, address: beneficiary3, amount: ether('0.61567').toString()}
    const beneficiary4Node = {token, address: beneficiary4, amount: ether('0.005').toString()}

    beforeEach(async () => {
      const merkleTreeNodes = [
        beneficiaryNode,
        beneficiary2Node,
        beneficiary3Node,
        beneficiary4Node
      ]

      let totalEtherForAllNodes = 0.0
      for(let i = 0; i < merkleTreeNodes.length; i++) {
        let node = merkleTreeNodes[i]
        totalEtherForAllNodes += parseFloat(ethers.utils.formatEther(node.amount))
      }

      this.merkleTree = parseNodesAndBuildMerkleTree(merkleTreeNodes)

      this.vault = await MerkleVault.new()

      await this.vault.updateMerkleTree({
        root: this.merkleTree.merkleRoot,
        dataIPFSHash: randomIPFSHash
      })

      // send ETH to the vault
      const [ownerSigner] = await ethers.getSigners();
      await ownerSigner.sendTransaction({
        to: this.vault.address,
        value: ethers.utils.parseEther(totalEtherForAllNodes.toString())
      });

      await this.vault.unpauseClaiming()

      expect(await balance.current(this.vault.address)).to.be.bignumber.equal(ethers.utils.parseEther(totalEtherForAllNodes.toString()).toString())

      this.totalEtherForAllNodes = ethers.utils.parseEther(totalEtherForAllNodes.toString()).toString()
    })

    it('all beneficiaries can claim their ETH', async () => {
      const beneficiaryBalTracker = await balance.tracker(beneficiary)

      const gasPrice = new BN(web3.utils.toWei('1', 'gwei').toString());
      let tx = await this.vault.claim(
        this.merkleTree.claims[beneficiary].index,
        ZERO_ADDRESS,
        beneficiaryNode.amount,
        this.merkleTree.claims[beneficiary].proof,
        {from: beneficiary, gasPrice}
      )

      await expectEvent(tx.receipt, 'TokensClaimed', {
        token: ZERO_ADDRESS,
        amount: beneficiaryNode.amount
      })

      let gasUsed = new BN(tx.receipt.cumulativeGasUsed);
      let txCost = gasUsed.mul(gasPrice);

      expect(await beneficiaryBalTracker.delta()).to.be.bignumber.equal(new BN(beneficiaryNode.amount).sub(txCost))

      const beneficiary2BalTracker = await balance.tracker(beneficiary2)

      tx = await this.vault.claim(
        this.merkleTree.claims[beneficiary2].index,
        ZERO_ADDRESS,
        beneficiary2Node.amount,
        this.merkleTree.claims[beneficiary2].proof,
        {from: beneficiary2, gasPrice}
      )

      gasUsed = new BN(tx.receipt.cumulativeGasUsed);
      txCost = gasUsed.mul(gasPrice);

      expect(await beneficiary2BalTracker.delta()).to.be.bignumber.equal(new BN(beneficiary2Node.amount).sub(txCost))

      const beneficiary3BalTracker = await balance.tracker(beneficiary3)

      tx = await this.vault.claim(
        this.merkleTree.claims[beneficiary3].index,
        ZERO_ADDRESS,
        beneficiary3Node.amount,
        this.merkleTree.claims[beneficiary3].proof,
        {from: beneficiary3, gasPrice}
      )

      gasUsed = new BN(tx.receipt.cumulativeGasUsed);
      txCost = gasUsed.mul(gasPrice);

      expect(await beneficiary3BalTracker.delta()).to.be.bignumber.equal(new BN(beneficiary3Node.amount).sub(txCost))

      const beneficiary4BalTracker = await balance.tracker(beneficiary4)

      tx = await this.vault.claim(
        this.merkleTree.claims[beneficiary4].index,
        ZERO_ADDRESS,
        beneficiary4Node.amount,
        this.merkleTree.claims[beneficiary4].proof,
        {from: beneficiary4, gasPrice}
      )

      gasUsed = new BN(tx.receipt.cumulativeGasUsed);
      txCost = gasUsed.mul(gasPrice);

      expect(await beneficiary4BalTracker.delta()).to.be.bignumber.equal(new BN(beneficiary4Node.amount).sub(txCost))

      // check that the contract has no funds left
      expect(await balance.current(this.vault.address)).to.be.bignumber.equal('0')
    })

    it('can carry forward unclaimed balances to a new version of the tree', async () => {
      // first 2 beneficiaries claim
      await this.vault.claim(
        this.merkleTree.claims[beneficiary].index,
        ZERO_ADDRESS,
        beneficiaryNode.amount,
        this.merkleTree.claims[beneficiary].proof,
        {from: beneficiary}
      )

      await this.vault.claim(
        this.merkleTree.claims[beneficiary2].index,
        ZERO_ADDRESS,
        beneficiary2Node.amount,
        this.merkleTree.claims[beneficiary2].proof,
        {from: beneficiary2}
      )

      // there should be ETH remaining in the contract for the final 2 beneficiaries
      expect(await balance.current(this.vault.address)).to.be.bignumber.equal((new BN(this.totalEtherForAllNodes).sub(new BN(beneficiaryNode.amount)).sub(new BN(beneficiary2Node.amount))).toString())

      // imagine some more funds come in due for beneficiary 5
      // we have 2 people that have not claimed + new claimant that need to go in the new tree
      const [ownerSigner] = await ethers.getSigners();
      await ownerSigner.sendTransaction({
        to: this.vault.address,
        value: ethers.utils.parseEther('0.732')
      });

      const beneficiary5Node = {token, address: beneficiary5, amount: ether('0.732').toString()}

      const newTreeNodes = [
        beneficiary3Node,
        beneficiary4Node,
        beneficiary5Node
      ]

      let totalEtherForAllNodes = 0.0
      for(let i = 0; i < newTreeNodes.length; i++) {
        let node = newTreeNodes[i]
        totalEtherForAllNodes += parseFloat(ethers.utils.formatEther(node.amount))
      }

      const oldTree = this.merkleTree
      this.merkleTree = parseNodesAndBuildMerkleTree(newTreeNodes)

      await this.vault.pauseClaiming()

      await expectRevert(
        this.vault.claim(
          this.merkleTree.claims[beneficiary4].index,
          ZERO_ADDRESS,
          beneficiary4Node.amount,
          this.merkleTree.claims[beneficiary4].proof,
          {from: beneficiary4}
        ),
        "Pausable: paused"
      )

      await this.vault.updateMerkleTree({
        root: this.merkleTree.merkleRoot,
        dataIPFSHash: randomIPFSHash
      })

      expect(await this.vault.merkleVersion()).to.be.bignumber.equal('2')

      await this.vault.unpauseClaiming()

      // let beneficiary 2 attempt to claim again and fail
      await expectRevert(
        this.vault.claim(
          oldTree.claims[beneficiary2].index,
          ZERO_ADDRESS,
          beneficiary2Node.amount,
          oldTree.claims[beneficiary2].proof,
          {from: beneficiary2}
        ),
        "Merkle verification failed"
      )

      // everyone in new tree claims
      await this.vault.claim(
        this.merkleTree.claims[beneficiary3].index,
        ZERO_ADDRESS,
        beneficiary3Node.amount,
        this.merkleTree.claims[beneficiary3].proof,
        {from: beneficiary3}
      )

      await this.vault.claim(
        this.merkleTree.claims[beneficiary4].index,
        ZERO_ADDRESS,
        beneficiary4Node.amount,
        this.merkleTree.claims[beneficiary4].proof,
        {from: beneficiary4}
      )

      await this.vault.claim(
        this.merkleTree.claims[beneficiary5].index,
        ZERO_ADDRESS,
        beneficiary5Node.amount,
        this.merkleTree.claims[beneficiary5].proof,
        {from: beneficiary5}
      )
    })
  })
})
