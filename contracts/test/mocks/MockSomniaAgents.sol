// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Request, Response, ResponseStatus} from "../../src/interfaces/ISomniaAgents.sol";

contract MockSomniaAgents {
    struct Pending {
        address callback;
        bytes4 selector;
        bytes payload;
        uint256 value;
        uint256 agentId;
    }

    uint256 public nextId = 1;
    bool public shouldRevert;
    mapping(uint256 => Pending) internal pending;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 id)
    {
        require(!shouldRevert, "mock: createRequest disabled");
        id = nextId++;
        pending[id] = Pending(callbackAddress, callbackSelector, payload, msg.value, agentId);
    }

    function pendingPayload(uint256 id) external view returns (bytes memory) {
        return pending[id].payload;
    }

    function pendingValue(uint256 id) external view returns (uint256) {
        return pending[id].value;
    }

    function pendingAgentId(uint256 id) external view returns (uint256) {
        return pending[id].agentId;
    }

    function pendingCallback(uint256 id) external view returns (address) {
        return pending[id].callback;
    }

    /// Calls the requester's callback exactly as the platform does: (requestId, responses, status, details).
    function fulfill(uint256 id, bytes calldata result, ResponseStatus status) external {
        Pending storage p = pending[id];
        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(this),
            result: result,
            status: status == ResponseStatus.Success ? ResponseStatus.Success : ResponseStatus.Failed,
            receipt: 0,
            timestamp: block.timestamp,
            executionCost: 0
        });
        Request memory details;
        details.id = id;
        details.threshold = 1;
        details.status = status;
        details.callbackAddress = p.callback;
        details.callbackSelector = p.selector;
        (bool ok, bytes memory ret) = p.callback.call(abi.encodeWithSelector(p.selector, id, responses, status, details));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {}
}
