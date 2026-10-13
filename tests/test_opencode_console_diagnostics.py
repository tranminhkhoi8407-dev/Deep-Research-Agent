"""Credential isolation/redaction regressions; no CLI, network or model calls."""
import json
import sqlite3
from types import SimpleNamespace

import pytest

from scripts import opencode_console_login as login
from scripts import check_opencode_console_access as diagnostic


@pytest.fixture
def own_profile(tmp_path, monkeypatch):
    profile = tmp_path / "dedicated-profile"
    (profile / "data").mkdir(parents=True)
    monkeypatch.setattr(login, "PROFILE", profile)
    with sqlite3.connect(profile / "data/opencode.db") as conn:
        conn.executescript("""
            CREATE TABLE credential(integration_id TEXT, active INTEGER, value TEXT);
            CREATE TABLE account(id TEXT, access_token TEXT, token_expiry INTEGER, url TEXT);
            CREATE TABLE account_state(active_account_id TEXT, active_org_id TEXT);
        """)
    login.write_profile()
    return profile


def seed_account(profile, server="https://opencode.ai/console"):
    with sqlite3.connect(profile / "data/opencode.db") as conn:
        conn.execute("INSERT INTO account VALUES(?,?,?,?)", ("own-account", "fixture-token-not-real", 9999999999999, server))
        conn.execute("INSERT INTO account_state VALUES(?,?)", ("own-account", "fixture-org"))


def test_v1_console_login_uses_only_its_own_active_account(own_profile):
    seed_account(own_profile)
    value = login.console_credential()
    assert value["source"] == "v1-account"
    assert value["access"] == "fixture-token-not-real"
    assert value["metadata"]["orgID"] == "fixture-org"


def test_credential_store_supported_without_account_fallback(own_profile):
    value = {"type": "oauth", "access": "fixture-integration-token", "metadata": {"server": "https://opencode.ai/console"}}
    with sqlite3.connect(own_profile / "data/opencode.db") as conn:
        conn.execute("INSERT INTO credential VALUES(?,?,?)", ("opencode", 1, json.dumps(value)))
    assert login.console_credential() == value


def test_no_desktop_or_alternate_server_fallback(own_profile):
    with pytest.raises(ValueError):
        login.console_credential()
    seed_account(own_profile, "https://example.org/console")
    with pytest.raises(ValueError):
        login.console_credential()


def test_environment_strips_old_keys_and_keeps_paths_in_own_profile(own_profile, monkeypatch):
    monkeypatch.setenv("OPENCODE_AUTH_CONTENT", "do-not-use-desktop-auth")
    monkeypatch.setenv("OPENAI_API_KEY", "do-not-use-provider-key")
    env = login.isolated_environment()
    assert "OPENCODE_AUTH_CONTENT" not in env and "OPENAI_API_KEY" not in env
    assert env["OPENCODE_DB"] == str(own_profile / "data/opencode.db")
    assert env["OPENCODE_DISABLE_PROJECT_CONFIG"] == "true"


@pytest.mark.parametrize("unsafe", [False, True])
def test_masked_debug_credential_is_not_treated_as_a_real_token(own_profile, monkeypatch, capsys, unsafe):
    seed_account(own_profile)
    monkeypatch.setattr(diagnostic.subprocess, "check_output", lambda *args, **kwargs: "1.19.0")
    monkeypatch.setattr(diagnostic, "ROOT", own_profile.parent)
    # The executable helper imports this sibling in standalone mode.
    monkeypatch.syspath_prepend(str(diagnostic.ROOT / "unused"))
    monkeypatch.setitem(__import__("sys").modules, "opencode_console_login", login)
    monkeypatch.setattr(__import__("sys"), "argv", ["check", "--binary", "fixture-cli", "--model", "longcat-2.5-preview-free", "--credential-source", "console-token", "--live"])
    calls = []
    def fake_run(command, **kwargs):
        calls.append(command)
        if command[1:3] == ["debug", "config"]:
            config = json.loads(kwargs["env"]["OPENCODE_CONFIG_CONTENT"])
            assert config["provider"]["nexora_console_diagnostic"]["options"]["apiKey"] == "fixture-token-not-real"
            config["provider"]["nexora_console_diagnostic"]["options"]["apiKey"] = "***"
            if unsafe:
                config["mcp"] = {"unexpected": {"enabled": True}}
            return SimpleNamespace(returncode=0, stdout=json.dumps(config), stderr="")
        assert command[1] == "run"
        assert command[command.index("--model") + 1] == "nexora_console_diagnostic/longcat-2.5-preview-free"
        event = {"type": "error", "error": {"message": "FreeTierError: free tier can only be used within OpenCode"}}
        return SimpleNamespace(returncode=1, stdout=json.dumps(event), stderr="")
    monkeypatch.setattr(diagnostic.subprocess, "run", fake_run)
    with pytest.raises(SystemExit) as result:
        diagnostic.main()
    assert result.value.code == 1
    output = capsys.readouterr().out
    assert "fixture-token-not-real" not in output
    assert len(calls) == (1 if unsafe else 2)
    assert ("diagnostic_profile_unsafe" if unsafe else "opencode_free_tier_restricted") in output
    # The real credential is not saved into an inline-config file.
    assert "fixture-token-not-real" not in (own_profile / "opencode.json").read_text()
