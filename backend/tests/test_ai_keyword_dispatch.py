"""AI keyword dispatch validation tests."""

from app.services.ai_service import _keyword_dispatch, _validate_tool_call


def test_keyword_dispatch_hydration_intent():
    out, calls = _keyword_dispatch("log 500ml water")
    assert "500ml" in out.lower()
    assert len(calls) == 1
    assert calls[0]["tool"] == "log_hydration"
    assert calls[0]["params"]["amount_ml"] == 500


def test_validate_tool_call_rejects_unknown_tool():
    err = _validate_tool_call({"tool": "hack_tool", "params": {}})
    assert err is not None
    assert "unsupported tool" in err


def test_validate_tool_call_rejects_unexpected_params():
    err = _validate_tool_call(
        {"tool": "log_hydration", "params": {"amount_ml": 250, "shell": "rm -rf /"}}
    )
    assert err is not None
    assert "unexpected params" in err
