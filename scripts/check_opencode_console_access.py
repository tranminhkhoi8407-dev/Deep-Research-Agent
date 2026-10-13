"""Opt-in direct OpenCode diagnostic, isolated from Nexora and desktop state.

Only the two explicitly selected Free models may be tested. No user documents,
desktop credentials, plugins, tools or paid-model fallback are used. Credentials
are read from the server's environment/.env and never printed or written in the
temporary profile. This is a diagnostic, not a production metering bypass.
"""
import argparse
from contextlib import nullcontext
import json
import os
from pathlib import Path
import subprocess
import tempfile

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
FREE_MODELS = ("longcat-2.5-preview-free", "mimo-v2.6-flash-free")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--model", required=True, choices=FREE_MODELS)
    parser.add_argument("--credential-source", choices=["service-key", "console-login", "console-token"], default="service-key", help="Use the server key, official CLI connection, or genuine token from our user-approved diagnostic login; never desktop auth")
    parser.add_argument("--live", action="store_true", help="Required consent to one tiny public-prompt model test")
    args = parser.parse_args()
    if not args.live:
        parser.error("Pass --live explicitly; this diagnostic makes a model request")
    credential = ""
    if args.credential_source == "service-key":
        load_dotenv(ROOT / ".env")
        load_dotenv(ROOT / "data/opencode/runtime.env")
        credential = os.getenv("OPENCODE_UPSTREAM_API_KEY", "").strip()
        if not credential or credential == "public":
            raise SystemExit("opencode_service_access_required")
    binary = str(Path(args.binary).resolve())
    if subprocess.check_output([binary, "--version"], text=True).strip() != "1.19.0":
        raise SystemExit("Pinned OpenCode 1.19.0 is required")
    selected = "opencode/" + args.model
    qa_root = ROOT / "tmp/research-visuals-qa"
    qa_root.mkdir(parents=True, exist_ok=True)
    if args.credential_source != "service-key":
        from opencode_console_login import PROFILE, console_credential, isolated_environment
        if not (PROFILE / "opencode.json").exists():
            raise SystemExit("Dedicated official Console login profile is missing")
        context = nullcontext(str(PROFILE))
    else:
        context = tempfile.TemporaryDirectory(prefix="console-direct-", dir=qa_root)
    with context as temporary:
        folder = Path(temporary)
        env = os.environ.copy()
        # Only the explicitly supplied Console service credential reaches this
        # diagnostic process. Production still keeps it behind Nexora's gateway.
        for name in list(env):
            if name.startswith("OPENCODE_") or name.endswith("API_KEY"):
                env.pop(name, None)
        env["NEXORA_CONSOLE_DIAGNOSTIC_KEY"] = credential
        for name in ("config", "cache", "state", "data", "workspace"):
            (folder / name).mkdir(exist_ok=True)
        env.update(
            XDG_CONFIG_HOME=str(folder / "config"), XDG_CACHE_HOME=str(folder / "cache"),
            XDG_STATE_HOME=str(folder / "state"), XDG_DATA_HOME=str(folder / "data"),
            OPENCODE_DB=str(folder / "data/opencode.db"), OPENCODE_CONFIG_DIR=str(folder / "config"),
            OPENCODE_CONFIG=str(folder / "opencode.json"), OPENCODE_PURE="true",
            OPENCODE_DISABLE_PROJECT_CONFIG="true", OPENCODE_DISABLE_AUTOUPDATE="true",
            OPENCODE_DISABLE_MODELS_FETCH="true", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER="true",
        )
        profile = {
            "$schema": "https://opencode.ai/config.json", "autoupdate": False,
            "share": "disabled", "plugin": [], "mcp": {}, "enabled_providers": ["opencode"],
            "model": selected, "small_model": selected, "permission": {"*": "deny"},
            "provider": {"opencode": {
                "options": {"baseURL": "https://opencode.ai/inference/openai/v1", "apiKey": "{env:NEXORA_CONSOLE_DIAGNOSTIC_KEY}", "timeout": 45000},
                "models": {args.model: {"limit": {"context": 128000, "output": 64}, "options": {"maxTokens": 64}}},
            }},
            "agent": {
                "nexora": {"mode": "primary", "steps": 2, "permission": {"*": "deny"},
                           "prompt": "This is a harmless public connectivity test. Reply only OK. Do not use tools, read files, search, create tasks or change models."},
                "title": {"disable": True}, "summary": {"disable": True},
            },
        }
        if args.credential_source != "service-key":
            env = isolated_environment()
            provider_id = "opencode"
            if args.credential_source == "console-token":
                # Explicitly test the genuine, user-approved OAuth session at
                # the documented endpoint, without manufacturing client IDs.
                logged_in = console_credential()
                credential = logged_in["access"]
                env["NEXORA_CONSOLE_DIAGNOSTIC_KEY"] = credential
                # Inline JSON is not a saved config file. Supply the genuine
                # token in the child environment only, never in a saved profile.
                profile["provider"]["opencode"]["options"]["apiKey"] = credential
                headers = {}
                org = logged_in.get("metadata", {}).get("orgID")
                if isinstance(org, str) and org:
                    headers["x-opencode-org-id"] = org
                profile["provider"]["opencode"]["options"]["headers"] = headers
                # The built-in provider is managed by the Console workspace.
                # A documented custom provider explicitly tests
                # the genuine current-API credential in the real CLI without
                # changing that account binding, desktop state or production.
                provider_id = "nexora_console_diagnostic"
                selected = provider_id + "/" + args.model
                provider = profile["provider"]["opencode"]
                provider["npm"] = "@ai-sdk/openai-compatible"
                profile["provider"] = {provider_id: provider}
                profile.update(enabled_providers=[provider_id], model=selected, small_model=selected)
                env["OPENCODE_CONFIG_CONTENT"] = json.dumps(profile)
            # Remote Console config must not regain tools/plugins or replace
            # isolation. Read the resolved configuration without dumping it.
            preflight = subprocess.run([binary, "debug", "config", "--pure"], cwd=folder / "workspace", env=env,
                                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                resolved = json.loads(preflight.stdout)
                agent = resolved.get("agent", {}).get("nexora", {})
                checks = {
                    "cli_resolved": preflight.returncode == 0,
                    "only_console_provider": resolved.get("enabled_providers") == [provider_id],
                    "no_external_plugins": not resolved.get("plugin"),
                    "no_mcp": not resolved.get("mcp"), "no_external_instructions": not resolved.get("instructions"),
                    "sharing_disabled": resolved.get("share") == "disabled",
                    "tools_denied": resolved.get("permission", {}).get("*") == "deny",
                    "bounded_agent": agent.get("mode") == "primary" and agent.get("steps") == 2,
                    "agent_tools_denied": agent.get("permission", {}).get("*") == "deny"
                    and not any(value is True for value in agent.get("tools", {}).values()),
                }
                if args.credential_source == "console-token":
                    options = resolved.get("provider", {}).get(provider_id, {}).get("options", {})
                    # `debug config` intentionally redacts all API keys. Its
                    # marker is not a credential and must never be used for an
                    # authentication probe or compared to the genuine token.
                    configured_key = options.get("apiKey", "")
                    checks["login_credential_supplied"] = bool(credential) and (
                        configured_key == credential or configured_key in {"***", "[REDACTED]", "<redacted>"})
                    checks["official_endpoint"] = options.get("baseURL") == "https://opencode.ai/inference/openai/v1"
                safe = all(checks.values())
            except (ValueError, TypeError, AttributeError):
                checks = {"cli_config_parsed": False}
                safe = False
            if not safe:
                print(json.dumps({"model": args.model, "direct_opencode": "blocked", "error_code": "diagnostic_profile_unsafe", "failed_checks": [name for name, passed in checks.items() if not passed], "model_request_sent": False}))
                raise SystemExit(1)
        else:
            (folder / "opencode.json").write_text(json.dumps(profile), encoding="utf-8")
        command = [binary, "run", "--pure", "--format", "json", "--agent", "nexora", "--model", selected,
                   "--title", "Nexora public connectivity diagnostic", "Reply only OK. No tools. Public connectivity test."]
        try:
            result = subprocess.run(command, cwd=folder / "workspace", env=env, capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=80,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except subprocess.TimeoutExpired:
            print(json.dumps({"model": args.model, "direct_opencode": "timeout", "user_documents_sent": False}))
            raise SystemExit(1) from None
        # Never dump raw stdout/stderr, which an SDK error could decorate with
        # request headers. Only extract diagnostic categories and public replies.
        events = []
        sanitized_stdout = result.stdout.replace(credential, "[redacted]") if credential else result.stdout
        for line in sanitized_stdout.splitlines():
            try:
                event = json.loads(line)
                if isinstance(event, dict):
                    events.append(event)
            except ValueError:
                pass
        errors = [event.get("error", {}) for event in events if event.get("type") == "error"]
        replies = [event.get("part", {}).get("text", "") for event in events if event.get("type") == "text"]
        diagnostic = "completed" if replies and not errors and result.returncode == 0 else "failed"
        sanitized_stderr = result.stderr.replace(credential, "[redacted]") if credential else result.stderr
        combined = json.dumps(errors) + sanitized_stderr
        if "FreeTierError" in combined or "free tier can only be used" in combined:
            code = "opencode_free_tier_restricted"
        elif "401" in combined or "Unauthorized" in combined:
            code = "opencode_provider_authentication"
        elif "429" in combined:
            code = "opencode_capacity"
        else:
            code = None if diagnostic == "completed" else "opencode_direct_request_failed"
        print(json.dumps({"model": args.model, "credential_source": args.credential_source, "direct_opencode": diagnostic, "error_code": code,
                          "user_documents_sent": False, "paid_fallback": False,
                          "public_reply": " ".join(replies)[:100] if diagnostic == "completed" else None}))
        if diagnostic != "completed":
            raise SystemExit(1)


if __name__ == "__main__":
    main()
