// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base64} from "../src/Base64.sol";

contract Base64Test is Test {
    function test_EncodesRfc4648Vectors() public pure {
        assertEq(Base64.encode(""), "");
        assertEq(Base64.encode("M"), "TQ==");
        assertEq(Base64.encode("Ma"), "TWE=");
        assertEq(Base64.encode("Man"), "TWFu");
        assertEq(Base64.encode("foobar"), "Zm9vYmFy");
    }

    function test_MatchesForgeOnJson() public pure {
        bytes memory json = bytes('{"name":"Basanos Certificate #1","external_url":"https://x/app/#/cert/1"}');
        assertEq(Base64.encode(json), vm.toBase64(json));
    }
}
