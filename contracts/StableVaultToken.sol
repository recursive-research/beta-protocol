// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract StableVaultToken is ERC20, Ownable {
    address public immutable token;

    constructor(address _token)
        ERC20(
            string(abi.encodePacked('Rift ', ERC20(_token).name(), ' Stable Vault Token V1')),
            string(abi.encodePacked('rsv', ERC20(_token).symbol(), 'v1'))
        )
    {
        token = _token;
    }

    function mint(address _user, uint256 _amount) external onlyOwner {
        _mint(_user, _amount);
    }

    function burn(address _user, uint256 _amount) external onlyOwner {
        _burn(_user, _amount);
    }
}
