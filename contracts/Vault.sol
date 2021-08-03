pragma solidity 0.8.6;

// SPDX-License-Identifier: MIT

import { Pausable } from "@openzeppelin/contracts/security/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vault is Pausable, ReentrancyGuard, Ownable {

    event ETHReceived(address indexed origin, uint256 amount);
    event ETHClaimed(address claimant, uint256 amount);

    uint256 public merkleVersion;

    // Merkle version -> merkle root
    mapping(uint256 => bytes32) public merkleRoots;

    // Beneficiary -> merkle version -> claimed
    mapping(address => mapping(uint256 => bool)) public fundsClaimed;

    function pauseClaiming() onlyOwner external {
        _pause();
    }

    function unpauseClaiming() onlyOwner external {
        _unpause();
    }

    function updateMerkleRoot(bytes32 _merkleRoot) external whenPaused onlyOwner {
        merkleVersion += 1;
        merkleRoots[merkleVersion] = _merkleRoot;
    }

    function claim(uint256 _index, uint256 _amount, bytes32[] calldata _merkleProof) external whenNotPaused nonReentrant {
        require(!fundsClaimed[msg.sender][merkleVersion], "Funds have been claimed");

        bytes32 node = keccak256(abi.encodePacked(_index, msg.sender, _amount));
        require(MerkleProof.verify(_merkleProof, merkleRoots[merkleVersion], node), "Merkle verification failed");

        fundsClaimed[msg.sender][merkleVersion] = true;

        (bool ethTransferSuccessful,) = msg.sender.call{value: _amount}("");
        require(ethTransferSuccessful, "ETH transfer failed");

        emit ETHClaimed(msg.sender, _amount);
    }

    // todo - ensure that this method will not consume more than 27k gas as this is what is forwarded from OS
    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    function recoverERC20(address _contract, address _recipient, uint256 _amount) external onlyOwner {
        IERC20(_contract).transfer(_recipient, _amount);
    }
}
