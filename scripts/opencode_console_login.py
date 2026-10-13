"""Official CLI Console login in a dedicated diagnostic profile.

No desktop auth is read or copied. The user must approve the vendor's device
flow themselves. This helper never prints access/refresh tokens and does not
alter the production worker, service key, model selection or billing.
"""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import threading
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data/opencode/console-diagnostic"
FREE_MODELS = ("longcat-2.5-preview-free", "mimo-v2.6-flash-free")


def console_credential():
    """Read only the credential created by our user-approved diagnostic login.

    Its database path is fixed to this profile. Never inspect any desktop or
    production auth store; never return the credential in CLI/tool output.
    """
    database = PROFILE / "data/opencode.db"
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as conn:
        rows = conn.execute("SELECT value FROM credential WHERE integration_id=? AND active=1", ("opencode",)).fetchall()
        accounts = conn.execute("SELECT a.access_token,a.token_expiry,a.url,s.active_org_id FROM account a JOIN account_state s ON a.id=s.active_account_id").fetchall()
    values = [json.loads(row[0]) for row in rows]
    candidates = [value for value in values if value.get("type") == "oauth" and value.get("access")
                  and value.get("metadata", {}).get("server", "https://opencode.ai/console") == "https://opencode.ai/console"]
    if len(candidates) == 1:
        return candidates[0]
    # V1 `console login` stores its device-flow session in Account/AccountState,
    # unlike the V2 integration credential store. Both are in our fixed DB.
    if not candidates and len(accounts) == 1:
        access, expires, server, org = accounts[0]
        if access and server.rstrip("/") == "https://opencode.ai/console":
            return {"type": "oauth", "access": access, "expires": expires,
                    "metadata": {"server": server, "orgID": org}, "source": "v1-account"}
    raise ValueError("No unique official Console credential in this diagnostic profile")


def isolated_environment():
    PROFILE.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    for key in list(env):
        if key.startswith("OPENCODE_") or key.endswith("API_KEY"):
            env.pop(key, None)
    for name in ("config", "cache", "state", "data", "workspace"):
        (PROFILE / name).mkdir(exist_ok=True)
    env.update(
        XDG_CONFIG_HOME=str(PROFILE / "config"), XDG_CACHE_HOME=str(PROFILE / "cache"),
        XDG_STATE_HOME=str(PROFILE / "state"), XDG_DATA_HOME=str(PROFILE / "data"),
        OPENCODE_DB=str(PROFILE / "data/opencode.db"), OPENCODE_CONFIG_DIR=str(PROFILE / "config"),
        OPENCODE_CONFIG=str(PROFILE / "opencode.json"), OPENCODE_PURE="true",
        OPENCODE_DISABLE_PROJECT_CONFIG="true", OPENCODE_DISABLE_AUTOUPDATE="true",
        OPENCODE_DISABLE_MODELS_FETCH="true", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER="true",
    )
    return env


def write_profile():
    selected = "opencode/" + FREE_MODELS[0]
    profile = {
        "$schema": "https://opencode.ai/config.json", "autoupdate": False,
        "share": "disabled", "plugin": [], "mcp": {}, "enabled_providers": ["opencode"],
        "model": selected, "small_model": selected, "permission": {"*": "deny"},
        # Let the official provider use its own authenticated Console flow. Do
        # not substitute service/public keys or reconstruct an auth database.
        "provider": {"opencode": {"models": {
            model: {"limit": {"context": 128000, "output": 64}, "options": {"maxTokens": 64}}
            for model in FREE_MODELS
        }}},
        "agent": {
            "nexora": {"mode": "primary", "steps": 2, "permission": {"*": "deny"},
                       "prompt": "Public connectivity test only. Reply only OK. No tools, files, search, edits or model changes."},
            "title": {"disable": True}, "summary": {"disable": True},
        },
    }
    (PROFILE / "opencode.json").write_text(json.dumps(profile), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--status", action="store_true", help="Read-only verification of this profile's resolved Console credential; no model requests")
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    if subprocess.check_output([binary, "--version"], text=True).strip() != "1.19.0":
        raise SystemExit("Pinned OpenCode 1.19.0 is required")
    env = isolated_environment()
    if args.status:
        try:
            credential = console_credential()
            headers = {"Authorization": "Bearer " + credential["access"]}
            org = credential.get("metadata", {}).get("orgID")
            if isinstance(org, str) and org:
                headers["x-org-id"] = org
            response = httpx.get("https://opencode.ai/console/api/v2/config", headers=headers,
                                 timeout=20, trust_env=False, follow_redirects=False)
            body = response.json()
            models = {model for provider in body.get("providers", {}).values() for model in provider.get("models", {})}
            print(json.dumps({"console_login_profile": "verified" if response.status_code == 200 else "not_verified",
                              "config_status": response.status_code,
                              "desired_models": {model: model in models for model in FREE_MODELS},
                              "desktop_credentials_used": False, "model_requests": 0}))
            raise SystemExit(0 if response.status_code == 200 else 1)
        except (ValueError, TypeError, AttributeError, sqlite3.DatabaseError, httpx.RequestError):
            print(json.dumps({"console_login_profile": "not_verified", "model_requests": 0}))
            raise SystemExit(1) from None
    write_profile()
    process = subprocess.Popen([binary, "console", "login", "https://opencode.ai/console", "--pure"],
                               cwd=PROFILE / "workspace", env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               encoding="utf-8", errors="replace", bufsize=1,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    seen = set()
    def safe_output():
        for raw in process.stdout:
            line = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", raw)
            # Device verification URLs are intended for the user. Never emit
            # raw CLI output, token payloads or arbitrary third-party URLs.
            for url in re.findall(r"https://opencode\.ai/[^\s\x1b<>\"']+", line):
                if "/device" in url and url not in seen:
                    seen.add(url)
                    print(json.dumps({"verification_url": url, "user_approval_required": True}), flush=True)
            if "signed in" in line.lower() or "login successful" in line.lower() or "logged in" in line.lower():
                print(json.dumps({"console_login": "cli_reported_success"}), flush=True)
    reader = threading.Thread(target=safe_output, daemon=True)
    reader.start()
    deadline = time.monotonic() + 630
    try:
        while process.poll() is None and time.monotonic() < deadline:
            time.sleep(.25)
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
            print(json.dumps({"console_login": "expired", "new_request_required": True}), flush=True)
            raise SystemExit(1)
        reader.join(timeout=5)
        print(json.dumps({"console_login": "cli_finished", "exit_code": process.returncode,
                          "verification_link_seen": bool(seen), "desktop_credentials_used": False}), flush=True)
        raise SystemExit(process.returncode)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)


if __name__ == "__main__":
    main()
