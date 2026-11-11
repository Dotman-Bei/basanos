// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The dreamDEX MarginBank views Basanos reads (signatures from @somnia-chain/markets-sdk 0.33.0 readsAbi).
interface IMarginBank {
    struct AccountState {
        int256 unlockedCollateralBalance;
        uint256 lockedCollateral;
        address[] activePerpPools;
    }

    struct Position {
        int128 size;
        uint128 avgEntryPrice;
        int256 entryFundingIndex;
        uint64 lastUpdatedTimestampNs;
    }

    function getAccountState(address account) external view returns (AccountState memory);
    function tryGetAccountEquity(address account) external view returns (bool ok, int256 equity);
    function getPosition(address account, address perpPool) external view returns (Position memory);
}
