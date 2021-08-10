pragma solidity 0.8.6;

// SPDX-License-Identifier: MIT

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20("MOCK", "MCK") {
    function mint(address _recipient, uint256 _amount) external {
        _mint(_recipient, _amount);
    }
}
