// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {Fixture} from "./Fixture.sol";

contract MetadataTest is Fixture {
    function test_TokenUriIsBase64JsonFromTheChainCheckedReads() public {
        vm.roll(100);
        uint256 runId = _start();
        bank.setEquity(trader, true, 1_006e18);
        vm.warp(block.timestamp + 61);
        vm.roll(250);
        vm.prank(referee);
        registry.recordPass(runId);
        string memory json = string.concat(
            '{"name":"Basanos Certificate #1",',
            '"description":"Every certificate is chain-checked at mint; every verdict is replayable.",',
            '"external_url":"https://basanos.example/app/#/cert/1","attributes":[',
            '{"trait_type":"rulebook","value":"',
            vm.toString(DEMO),
            '"},{"trait_type":"startBlock","value":100},{"trait_type":"endBlock","value":250},',
            '{"trait_type":"startEquity","value":"1000000000000000000000"},',
            '{"trait_type":"endEquity","value":"1006000000000000000000"}]}'
        );
        assertEq(registry.tokenURI(runId), string.concat("data:application/json;base64,", vm.toBase64(bytes(json))));
    }

    function test_TokenUriRevertsForAnUnmintedId() public {
        vm.expectRevert(BasanosRegistry.NonexistentToken.selector);
        registry.tokenURI(1);
    }

    function test_SupportsErc165Erc721MetadataAndErc5192() public view {
        assertTrue(registry.supportsInterface(0x01ffc9a7));
        assertTrue(registry.supportsInterface(0x80ac58cd));
        assertTrue(registry.supportsInterface(0x5b5e139f));
        assertTrue(registry.supportsInterface(0xb45a3c0e));
        assertFalse(registry.supportsInterface(0xffffffff));
    }

    function test_NameAndSymbol() public view {
        assertEq(registry.name(), "Basanos Certificate");
        assertEq(registry.symbol(), "BSNC");
    }
}
