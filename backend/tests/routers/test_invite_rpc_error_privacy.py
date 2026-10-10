from __future__ import annotations

import asyncio
import json
import logging
import traceback
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
from fastapi import HTTPException
from postgrest import AsyncPostgrestClient
import pytest

from app.routers import workspace_invites as invites

PRIVATE = "private-invite-row-and-provider-endpoint-sentinel"
BASE_URL = "https://database.invalid/rest/v1"
USER = {"sub": "user-1", "email": "Invitee@Example.com"}


@pytest.fixture
def rpc_transport(monkeypatch):
    async def run(respond, operation):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(respond), base_url=BASE_URL
        ) as http:
            client = AsyncPostgrestClient(BASE_URL, http_client=http)

            async def get_client():
                return SimpleNamespace(rpc=client.rpc)

            monkeypatch.setattr(invites, "get_async_supabase", get_client)
            return await operation()

    return run


@pytest.fixture
def side_effects(monkeypatch):
    activity = AsyncMock()
    enrich = AsyncMock(return_value={"id": "workspace-1"})
    monkeypatch.setattr(invites, "log_workspace_activity", activity)
    monkeypatch.setattr(invites, "_enriched_workspace_for_user", enrich)
    return activity, enrich


def assert_private_hidden(caplog, error):
    assert PRIVATE not in caplog.text
    assert all(PRIVATE not in repr(record.args) for record in caplog.records)
    assert PRIVATE not in str(error)
    assert PRIVATE not in "".join(traceback.format_exception(error))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", ["database", "auth", "server", "timeout", "connection", "malformed_json"]
)
async def test_real_rpc_failure_is_private_through_acceptance(
    rpc_transport, side_effects, caplog, failure
):
    requests = []

    def respond(request):
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/rpc/accept_workspace_invite_atomic"
        requests.append(json.loads(request.content))
        if failure in {"timeout", "connection"}:
            error_type = (
                httpx.ReadTimeout if failure == "timeout" else httpx.ConnectError
            )
            raise error_type(PRIVATE, request=request)
        if failure == "malformed_json":
            return httpx.Response(500, text=PRIVATE)
        status_code = {"database": 400, "auth": 401, "server": 500}[failure]
        return httpx.Response(
            status_code,
            json={
                "code": "22023",
                "message": PRIVATE,
                "details": PRIVATE,
                "hint": PRIVATE,
            },
        )

    with caplog.at_level(logging.INFO), pytest.raises(HTTPException) as error:
        await rpc_transport(
            respond,
            lambda: invites.accept_authenticated_workspace_invite(
                "invite-1", current_user=USER
            ),
        )

    assert requests == [
        {
            "p_invite_id": "invite-1",
            "p_user_id": "user-1",
            "p_email": "invitee@example.com",
        }
    ]
    assert error.value.status_code == 500
    assert error.value.detail == "Internal server error"
    assert "Atomic workspace invite acceptance failed" in caplog.text
    for effect in side_effects:
        effect.assert_not_awaited()
    assert_private_hidden(caplog, error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["provider", "transport"])
async def test_direct_rpc_boundary_normalizes_error_and_suppresses_raw_cause(
    rpc_transport, caplog, failure
):
    def respond(request):
        if failure == "transport":
            raise httpx.ConnectError(PRIVATE, request=request)
        return httpx.Response(
            400,
            json={
                "code": "22023",
                "message": PRIVATE,
                "hint": PRIVATE,
                "details": PRIVATE,
            },
        )

    with pytest.raises(invites.SupabaseServiceError) as error:
        await rpc_transport(
            respond,
            lambda: invites._accept_workspace_invite_rpc(
                "invite-1", "user-1", "invitee@example.com"
            ),
        )
    assert str(error.value) == "Internal server error"
    assert error.value.__cause__ is None
    assert error.value.__suppress_context__
    assert_private_hidden(caplog, error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "user,status_code",
    [({"sub": "", "email": "invitee@example.com"}, 401), ({"sub": "user-1"}, 400)],
)
async def test_invalid_identity_stops_before_rpc(
    monkeypatch, side_effects, user, status_code
):
    rpc = AsyncMock()
    monkeypatch.setattr(invites, "_accept_workspace_invite_rpc", rpc)
    with pytest.raises(HTTPException) as error:
        await invites.accept_authenticated_workspace_invite(
            "invite-1", current_user=user
        )
    assert error.value.status_code == status_code
    rpc.assert_not_awaited()
    for effect in side_effects:
        effect.assert_not_awaited()


@pytest.mark.asyncio
async def test_rpc_client_initialization_failure_is_private(
    monkeypatch, side_effects, caplog
):
    async def fail_client():
        raise RuntimeError(PRIVATE)

    monkeypatch.setattr(invites, "get_async_supabase", fail_client)
    with pytest.raises(HTTPException) as error:
        await invites.accept_authenticated_workspace_invite(
            "invite-1", current_user=USER
        )
    assert error.value.status_code == 500
    for effect in side_effects:
        effect.assert_not_awaited()
    assert_private_hidden(caplog, error.value)


@pytest.mark.asyncio
async def test_acceptance_does_not_log_or_chain_an_unsafe_rpc_error(
    monkeypatch, caplog, side_effects
):
    async def fail_rpc(*args):
        raise invites.SupabaseServiceError(PRIVATE)

    monkeypatch.setattr(invites, "_accept_workspace_invite_rpc", fail_rpc)
    with pytest.raises(HTTPException) as error:
        await invites.accept_authenticated_workspace_invite(
            "invite-1", current_user=USER
        )
    assert error.value.status_code == 500
    for effect in side_effects:
        effect.assert_not_awaited()
    assert_private_hidden(caplog, error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        {"outcome": PRIVATE, "accepted_workspace_id": PRIVATE},
        {"outcome": "accepted"},
        {},
        [],
    ],
)
async def test_invalid_rpc_results_are_private_and_have_no_side_effects(
    rpc_transport, caplog, side_effects, result
):
    with pytest.raises(HTTPException) as error:
        await rpc_transport(
            lambda request: httpx.Response(
                200, json=result if isinstance(result, list) else [result]
            ),
            lambda: invites.accept_authenticated_workspace_invite(
                "invite-1", current_user=USER
            ),
        )
    assert error.value.status_code == 500
    assert error.value.detail == "Internal server error"
    for effect in side_effects:
        effect.assert_not_awaited()
    assert_private_hidden(caplog, error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome,status_code",
    [("not_found", 404), ("not_pending", 400), ("workspace_not_found", 404)],
)
async def test_real_rpc_business_denials_preserve_status_without_side_effects(
    rpc_transport, side_effects, outcome, status_code
):
    with pytest.raises(HTTPException) as error:
        await rpc_transport(
            lambda request: httpx.Response(200, json=[{"outcome": outcome}]),
            lambda: invites.accept_authenticated_workspace_invite(
                "invite-1", current_user=USER
            ),
        )
    assert error.value.status_code == status_code
    for effect in side_effects:
        effect.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("membership_created", [True, False])
async def test_real_rpc_success_preserves_atomic_membership_semantics(
    rpc_transport, side_effects, membership_created
):
    result = {
        "outcome": "accepted",
        "accepted_workspace_id": "workspace-1",
        "membership_created": membership_created,
    }
    response = await rpc_transport(
        lambda request: httpx.Response(200, json=[result]),
        lambda: invites.accept_authenticated_workspace_invite(
            "invite-1", current_user=USER
        ),
    )
    assert response == {"id": "workspace-1"}
    activity, enrich = side_effects
    activity.assert_awaited_once_with(
        workspace_id="workspace-1",
        actor_user_id="user-1",
        event_type="workspace.member_joined",
        summary="A teammate joined the workspace.",
        metadata={"invite_id": "invite-1", "membership_created": membership_created},
    )
    enrich.assert_awaited_once_with("workspace-1", "user-1")


@pytest.mark.asyncio
async def test_rpc_cancellation_is_not_reported_as_database_failure(
    monkeypatch, side_effects, caplog
):
    async def cancel_client():
        raise asyncio.CancelledError()

    monkeypatch.setattr(invites, "get_async_supabase", cancel_client)
    with pytest.raises(asyncio.CancelledError):
        await invites.accept_authenticated_workspace_invite(
            "invite-1", current_user=USER
        )
    assert "Atomic workspace invite acceptance failed" not in caplog.text
    for effect in side_effects:
        effect.assert_not_awaited()
