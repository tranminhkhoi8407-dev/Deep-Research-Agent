"""Private OpenCode adapter and metered provider gateway.

One SQLite lease serializes this controlled worker across backend processes.
Only the gateway holds upstream credentials. It enforces calls, input/output
reservations, model identity and deadlines BEFORE forwarding every request.
Neither the personal desktop server nor its credentials are discovered/reused.
"""
import json
import os
import re
import secrets
import sys
import time
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import AIMessage

from agent import model_output
from agent.research_contract import ReportDraft, VisualDraft
from backend.research_chat_store import db, cancelled
from backend import opencode_native as native

router = APIRouter(prefix="/internal/opencode", tags=["private OpenCode worker"])
# Console workspace config and the current service-account API use this path.
# Keep it fixed server-side; neither browser nor model can choose an endpoint.
UPSTREAM_URL = "https://opencode.ai/inference/openai/v1/chat/completions"
PROVIDER_ID = "opencode_nexora_gateway"
MODEL_POLICIES = {
    native.MODEL_ID: ("Nexora · configured provider", "configured_provider"),
    "longcat-2.5-preview-free": ("LongCat 2.5 Preview Free", "preview_zero_retention"),
    "mimo-v2.6-flash-free": ("MiMo-V2.6-Flash Free", "improvement_data"),
    "ling-3.1-flash-free": ("Ling 3.1 Flash Free", "improvement_data"),
    "nemotron-3-ultra-free": ("Nemotron 3 Ultra Free", "trial_no_confidential"),
    "nemotron-3.5-lightning-free": ("Nemotron 3.5 Lightning Free", "trial_no_confidential"),
    "muse-spark-1.3-contributor-free": ("Muse Spark 1.3 Contributor Free", "training_data"),
}


class RuntimeErrorSafe(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def allowed_models():
    selected = [item.strip() for item in os.getenv("OPENCODE_ALLOWED_MODELS", "longcat-2.5-preview-free,mimo-v2.6-flash-free").split(",") if item.strip() in MODEL_POLICIES]
    if os.getenv('OPENCODE_DIRECT_ENABLED', 'false').lower() == 'true' and 'muse-spark-1.3-contributor-free' not in selected:
        selected.append('muse-spark-1.3-contributor-free')
    if os.getenv("OPENCODE_ENABLE_CONFIGURED_PROVIDER", "true").lower() == "true":
        selected.insert(0, native.MODEL_ID)
    else:
        selected = [model for model in selected if model != native.MODEL_ID]
    return list(dict.fromkeys(selected))


def private_allowed(model):
    # Explicit deployment choice only. Trial/training endpoints stay public-only
    # even if accidentally added to a permissive environment variable.
    return model == native.MODEL_ID or (model in os.getenv("OPENCODE_PRIVATE_MODELS", "").split(",") and MODEL_POLICIES.get(model, (None, None))[1] == "preview_zero_retention")


def access_for_model(model, binding=None):
    if model == native.MODEL_ID:
        try:
            resolved = native.current_binding()
            if binding is not None and resolved != binding:
                raise RuntimeErrorSafe("opencode_configured_model_changed")
            return resolved
        except native.NativeAdapterError as exc:
            raise RuntimeErrorSafe(exc.code) from None
    access = os.getenv("OPENCODE_UPSTREAM_API_KEY", "").strip()
    if not access or access == "public":
        raise RuntimeErrorSafe("opencode_service_access_required")
    return {}


def configured():
    return all(os.getenv(key) for key in ("OPENCODE_SERVER_URL", "OPENCODE_SERVER_PASSWORD", "OPENCODE_GATEWAY_TOKEN"))


def safe_url():
    value = os.getenv("OPENCODE_SERVER_URL", "").rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise RuntimeErrorSafe("opencode_configuration")
    if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1", "opencode"}:
        raise RuntimeErrorSafe("opencode_requires_tls")
    return value


def client(timeout=10):
    if not configured():
        raise RuntimeErrorSafe("opencode_not_configured")
    return httpx.Client(base_url=safe_url(), auth=(os.getenv("OPENCODE_SERVER_USERNAME", "opencode"), os.environ["OPENCODE_SERVER_PASSWORD"]), timeout=timeout, follow_redirects=False, trust_env=False)


def request(runtime, method, path, **kwargs):
    try:
        response = runtime.request(method, path, **kwargs)
        if response.status_code in (401, 403):
            raise RuntimeErrorSafe("opencode_authentication")
        if response.status_code == 404:
            raise RuntimeErrorSafe("opencode_session_missing")
        if response.status_code == 429:
            raise RuntimeErrorSafe("opencode_capacity")
        if response.status_code >= 400:
            raise RuntimeErrorSafe("opencode_request_failed")
        return response.json()
    except (httpx.TimeoutException, httpx.RequestError):
        raise RuntimeErrorSafe("opencode_unreachable") from None
    except ValueError:
        raise RuntimeErrorSafe("opencode_incompatible") from None


def verify_worker(runtime):
    health = request(runtime, "GET", "/global/health")
    config = request(runtime, "GET", "/config")
    provider = config.get("provider", {}).get(PROVIDER_ID, {})
    options = provider.get("options", {})
    expected = os.getenv("OPENCODE_GATEWAY_URL", "http://127.0.0.1:8000/internal/opencode/v1").rstrip("/")
    agent = config.get("agent", {}).get("nexora", {})
    permission = config.get("permission", {})
    # A worker with another provider or plugin can bypass metering/isolation.
    if (health.get("version") != "1.19.0" or config.get("enabled_providers") != [PROVIDER_ID] or set(config.get("provider", {})) != {PROVIDER_ID}
        or options.get("baseURL", "").rstrip("/") != expected
        or native.MODEL_ID not in provider.get("models", {})
        or not secrets.compare_digest(str(options.get("apiKey", "")), os.environ["OPENCODE_GATEWAY_TOKEN"])
        or config.get("plugin") or config.get("share") != "disabled"
        or permission.get("*") != "deny" or not agent or agent.get("mode") != "primary"
        or not 2 <= agent.get("steps", 0) <= 12):
        raise RuntimeErrorSafe("opencode_worker_unsafe")
    # Confirm dangerous built-ins aren't re-enabled by agent overrides.
    rules = {**permission, **agent.get("permission", {})}
    if rules.get("*") != "deny" or any(rules.get(name, "deny") != "deny" for name in ("bash", "read", "edit", "glob", "grep", "webfetch", "websearch", "task", "external_directory")):
        raise RuntimeErrorSafe("opencode_worker_unsafe")
    # Fail closed if another MCP server/tool or deprecated tools configuration
    # can regain access to the host. The local bridge is the reviewed reader.
    from pathlib import Path
    mcp = config.get("mcp", {})
    reader = mcp.get("nexora_evidence", {})
    command = reader.get("command", [])
    trusted_script = Path(__file__).resolve().parents[1] / "scripts/opencode_reader.py"
    if (set(mcp) != {"nexora_evidence"} or reader.get("type") != "local" or reader.get("enabled") is not True
        or config.get("instructions") or len(command) != 4 or command[1:3] != ["-X", "utf8"]
        or Path(command[0]).resolve() != Path(sys.executable).resolve()
        or Path(command[-1]).resolve() != trusted_script or reader.get("environment")
        or any(value is True for value in config.get("tools", {}).values())
        or any(value is True for value in agent.get("tools", {}).values())):
        raise RuntimeErrorSafe("opencode_worker_unsafe")
    return health


def status():
    models = []
    for model in allowed_models():
        entry = {"id": model, "name": MODEL_POLICIES[model][0], "policy": MODEL_POLICIES[model][1], "private_allowed": private_allowed(model), "ready": False, "code": "opencode_not_configured"}
        try:
            binding = access_for_model(model)
            entry.update(ready=True, code="ready")
            if binding:
                entry["name"] = native.binding_label(binding)
        except RuntimeErrorSafe as exc:
            entry["code"] = exc.code
        models.append(entry)
    payload = {"configured": configured(), "ready": False, "code": "opencode_not_configured", "models": models}
    if not payload["configured"]:
        return payload
    try:
        with client() as runtime:
            health = verify_worker(runtime)
            ready = any(model["ready"] for model in models)
            payload.update(worker_ready=True, ready=ready, code="ready" if ready else "opencode_native_configuration", version=health.get("version"))
    except RuntimeErrorSafe as exc:
        payload["code"] = exc.code
    return payload


def require_gateway(request):
    expected = os.getenv("OPENCODE_GATEWAY_TOKEN", "")
    received = request.headers.get("authorization", "")
    if len(expected) < 24 or not secrets.compare_digest(received, "Bearer " + expected):
        raise HTTPException(403, "Worker authentication required")


def lease_row(conn):
    row = conn.execute("SELECT * FROM opencode_lease WHERE slot=1").fetchone()
    if not row or row["expires_at"] < time.time():
        raise HTTPException(409, "No active authorized worker request")
    job = conn.execute("SELECT cancel_requested,status FROM research_chat_jobs WHERE id=?", (row["job_id"],)).fetchone()
    if not job or job["cancel_requested"] or job["status"] != "running":
        raise HTTPException(409, "Worker turn stopped")
    return row


def upstream_client():
    """Separate transport seam for offline protocol tests, never a client URL."""
    return httpx.AsyncClient(timeout=60, follow_redirects=False, trust_env=False)


@router.post("/v1/chat/completions")
async def gateway(request: Request):
    require_gateway(request)
    raw = await request.body()
    if len(raw) > 400000:
        raise HTTPException(413, "Worker input too large")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid worker request") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        raise HTTPException(400, "Invalid worker request")
    estimate = (len(raw) + 1) // 2 + 200
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        lease = lease_row(conn)
        context = json.loads(lease["context"])
        estimate += 4096 * len(context.get('chat_images', []))
        # Forward only authentic runtime metadata from the controlled process,
        # never manufacture CLI headers for an ordinary API caller.
        if request.headers.get("x-opencode-session") not in context.get("sessions", []):
            raise HTTPException(403, "Worker session is not authorized")
        if context["model"] not in allowed_models():
            raise HTTPException(400, "Worker model is no longer allowed")
        budget = context["budget"]
        cap = min(lease["cap"], budget["max_output_tokens"] - lease["output_reserved"])
        if (payload.get("model") != context["model"] or lease["calls"] >= budget["max_llm_calls"] or cap < 100
            or lease["input_reserved"] + estimate > budget["max_input_tokens"]):
            raise HTTPException(429, "Worker model or budget limit reached")
        conn.execute("UPDATE opencode_lease SET calls=calls+1,input_reserved=input_reserved+?,output_reserved=output_reserved+? WHERE slot=1", (estimate, cap))
        jid = lease["job_id"]
    # Don't forward provider-specific overrides, extra credentials, URLs or a
    # different model/endpoint requested by a malicious tool/model.
    allowed = {"model", "messages", "tools", "tool_choice", "temperature", "top_p", "stream", "stop", "parallel_tool_calls"}
    payload = {k: v for k, v in payload.items() if k in allowed}
    payload["max_tokens"] = cap
    if context["model"] == native.MODEL_ID:
        try:
            value = await native.completion(payload, context, request.headers["x-opencode-session"], jid, cap, lease["expires_at"])
        except Exception as exc:
            code = exc.code if isinstance(exc, native.NativeAdapterError) else "opencode_native_generation_failed"
            with db() as conn:
                active = conn.execute("SELECT context FROM opencode_lease WHERE job_id=?", (jid,)).fetchone()
                if active:
                    failed = json.loads(active["context"])
                    failed["provider_error"] = code
                    conn.execute("UPDATE opencode_lease SET context=? WHERE job_id=?", (json.dumps(failed), jid))
            return JSONResponse({"error": {"message": "Configured Nexora model request did not complete", "code": code}}, status_code=400)
        with db() as conn:
            conn.execute("UPDATE opencode_lease SET input_measured=input_measured+?,output_measured=output_measured+? WHERE job_id=?", (value["usage"]["prompt_tokens"], value["usage"]["completion_tokens"], jid))
        return StreamingResponse(native.sse(value), media_type="text/event-stream", headers={"Cache-Control": "no-store"}) if payload.get("stream") else JSONResponse(value)
    if payload.get("stream"):
        payload["stream_options"] = {"include_usage": True}
    upstream = upstream_client()
    try:
        runtime_headers = {name: request.headers[name] for name in ("user-agent", "x-opencode-session-id", "x-opencode-session", "x-opencode-parent-session-id", "x-opencode-project", "x-opencode-request", "x-opencode-client") if name in request.headers}
        runtime_headers["Authorization"] = "Bearer " + os.getenv("OPENCODE_UPSTREAM_API_KEY", "public")
        response = await upstream.send(upstream.build_request("POST", UPSTREAM_URL, headers=runtime_headers, json=payload), stream=True)
    except httpx.RequestError:
        await upstream.aclose()
        raise HTTPException(502, "Provider unavailable") from None
    if response.status_code != 200:
        code = "opencode_capacity" if response.status_code == 429 else "opencode_provider_rejected"
        try:
            detail = json.loads(await response.aread())
            if detail.get("error", {}).get("type") == "FreeTierError":
                code = "opencode_free_tier_restricted"
        except (ValueError, TypeError, AttributeError):
            pass
        with db() as conn:
            active = conn.execute("SELECT context FROM opencode_lease WHERE job_id=?", (jid,)).fetchone()
            if active:
                failed_context = json.loads(active["context"])
                failed_context["provider_error"] = code
                failed_context["provider_status"] = response.status_code
                conn.execute("UPDATE opencode_lease SET context=? WHERE job_id=?", (json.dumps(failed_context), jid))
        await response.aclose()
        await upstream.aclose()
        # No raw upstream errors, credentials or internal URLs reach the UI.
        # Non-retryable adapter response: SDK/session backoff must not replay
        # denied/capacity requests behind Nexora's explicit user retry policy.
        return JSONResponse({"error": {"message": "Provider rejected research request", "code": code}}, status_code=400)

    async def stream():
        usage = {}
        try:
            if not payload.get("stream"):
                data = await response.aread()
                value = json.loads(data)
                usage = value.get("usage", {})
                if not cancelled(jid) and time.time() <= lease["expires_at"]:
                    yield data
            else:
                async for line in response.aiter_lines():
                    if cancelled(jid) or time.time() > lease["expires_at"]:
                        break
                    if line.startswith("data:") and line[5:].strip() != "[DONE]":
                        try:
                            usage.update(json.loads(line[5:]).get("usage", {}))
                        except (ValueError, TypeError):
                            pass
                    yield (line + "\n").encode("utf-8")
        finally:
            with db() as conn:
                conn.execute("UPDATE opencode_lease SET input_measured=input_measured+?,output_measured=output_measured+? WHERE slot=1 AND job_id=?", (int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0)), jid))
            await response.aclose()
            await upstream.aclose()
    return StreamingResponse(stream(), media_type="text/event-stream" if payload.get("stream") else "application/json", headers={"Cache-Control": "no-store"})


@router.post("/reader")
async def reader(request: Request):
    supplied = request.headers.get('authorization', '')
    if not supplied.startswith('Bearer ') or len(supplied) < 31:
        raise HTTPException(403, 'Worker authentication required')
    raw = await request.body()
    if len(raw) > 16000:
        raise HTTPException(413, "Reader request too large")
    try:
        args = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid reader request") from None
    if not isinstance(args, dict):
        raise HTTPException(400, "Invalid reader request")
    with db() as conn:
        lease = lease_row(conn)
        context = json.loads(lease["context"])
    # Direct CLI children and their MCP bridge get ONLY this job's capability.
    # A bridge left behind after cancellation cannot read the next owner's data.
    expected = context.get('direct_token', '') if context.get('transport') == 'direct_v1' else os.getenv('OPENCODE_GATEWAY_TOKEN', '')
    if len(expected) < 24 or not secrets.compare_digest(supplied, 'Bearer ' + expected):
        raise HTTPException(403, 'Worker authentication required')
    chunks = context.get("evidence", [])
    if args.get("tool") == "search":
        query = str(args.get("query", ""))[:300]
        terms = set(re.findall(r"\w+", query.lower()))
        ranked = sorted(chunks, key=lambda item: sum(word in item["text"].lower() for word in terms), reverse=True)[:5]
        return {"scope": "Only authorized, previously read excerpts; not exhaustive full text", "chunks": [{"id": item["id"], "title": item.get("title"), "locator": item.get("locator"), "preview": item["text"][:500]} for item in ranked]}
    if args.get("tool") == "read":
        ids = args.get("ids", [])
        known = {item["id"]: item for item in chunks}
        if not isinstance(ids, list) or not 1 <= len(ids) <= 4 or any(not isinstance(item, str) or item not in known for item in ids):
            raise HTTPException(404, "Excerpt not authorized")
        return {"chunks": [known[item] for item in ids]}
    raise HTTPException(400, "Unknown reader operation")


def inline_schema(wire):
    definitions = wire.get("$defs", {})
    def visit(value):
        if isinstance(value, list):
            return [visit(item) for item in value]
        if isinstance(value, dict):
            if "$ref" in value:
                return visit(definitions[value["$ref"].split("/")[-1]])
            return {k: visit(v) for k, v in value.items() if k != "$defs"}
        return value
    return visit(wire)


class OpenCodeTurn:
    def __init__(self, job, conversation, budget, evidence=None):
        self.job, self.conversation, self.budget = job, conversation, budget
        self.evidence = evidence or []
        self.runtime = None
        self.session = conversation.get("runtime_session")

    def __enter__(self):
        binding = json.loads(self.conversation.get("runtime_binding", "{}"))
        access_for_model(self.conversation["model"], binding if self.conversation["model"] == native.MODEL_ID else None)
        self.runtime = client(timeout=65)
        try:
            verify_worker(self.runtime)
            # A timed-out/aborted previous session must be idle before the global
            # MCP reader scope is leased to another owner. Do not race stale tools.
            statuses = request(self.runtime, "GET", "/session/status")
            if any(value.get("type") != "idle" for value in statuses.values()):
                raise RuntimeErrorSafe("opencode_worker_busy")
            with db() as conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM opencode_lease WHERE slot=1").fetchone()
                if row and row["expires_at"] > time.time():
                    raise RuntimeErrorSafe("opencode_worker_busy")
                conn.execute("DELETE FROM opencode_lease WHERE slot=1")
                context = {"owner": self.conversation["owner_id"], "model": self.conversation["model"], "binding": binding, "budget": self.budget, "evidence": self.evidence, "sessions": []}
                conn.execute("INSERT INTO opencode_lease(slot,job_id,expires_at,context) VALUES(1,?,?,?)", (self.job, time.time() + self.budget["max_seconds"], json.dumps(context)))
            if not self.session:
                self.session = request(self.runtime, "POST", "/session", json={"title": self.conversation["title"][:120], "permission": [{"permission": "*", "pattern": "*", "action": "deny"}, {"permission": "nexora_evidence_*", "pattern": "*", "action": "allow"}, {"permission": "StructuredOutput", "pattern": "*", "action": "allow"}]})["id"]
                with db() as conn:
                    conn.execute("UPDATE research_conversations SET runtime_session=? WHERE id=?", (self.session, self.conversation["id"]))
            else:
                request(self.runtime, "GET", "/session/" + self.session)
                request(self.runtime, "PATCH", "/session/" + self.session, json={"title": self.conversation["title"][:120]})
            with db() as conn:
                row = conn.execute("SELECT context FROM opencode_lease WHERE job_id=?", (self.job,)).fetchone()
                context = json.loads(row["context"])
                context["sessions"] = [self.session]
                conn.execute("UPDATE opencode_lease SET context=? WHERE job_id=?", (json.dumps(context), self.job))
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *_):
        with db() as conn:
            row = conn.execute("SELECT * FROM opencode_lease WHERE job_id=?", (self.job,)).fetchone()
            if row:
                usage = {k: row[k] for k in ("calls", "input_reserved", "output_reserved", "input_measured", "output_measured")}
                error_context = json.loads(row["context"])
                if "provider_status" in error_context:
                    usage["provider_status"] = error_context["provider_status"]
                conn.execute("UPDATE research_chat_jobs SET usage=?,updated_at=? WHERE id=?", (json.dumps(usage), time.time(), self.job))
            conn.execute("DELETE FROM opencode_lease WHERE job_id=?", (self.job,))
        if self.runtime:
            self.runtime.close()

    def prompt(self, system, text, *, wire=None, cap=1500, evidence=None, isolated=False):
        if cancelled(self.job):
            raise RuntimeErrorSafe("cancelled")
        with db() as conn:
            row = lease_row(conn)
            context = json.loads(row["context"])
            if evidence is not None:
                context["evidence"] = evidence
            conn.execute("UPDATE opencode_lease SET cap=?,context=? WHERE job_id=?", (cap, json.dumps(context), self.job))
            before = (row["input_measured"], row["output_measured"], row["calls"])
        session = self.session
        if isolated:
            session = request(self.runtime, "POST", "/session", json={"title": "Nexora isolated evidence audit"})["id"]
            with db() as conn:
                row = lease_row(conn)
                context = json.loads(row["context"])
                context["sessions"].append(session)
                conn.execute("UPDATE opencode_lease SET context=? WHERE job_id=?", (json.dumps(context), self.job))
        body = {"agent": "nexora", "model": {"providerID": PROVIDER_ID, "modelID": self.conversation["model"]}, "system": system, "parts": [{"type": "text", "text": text}]}
        if wire:
            body["format"] = {"type": "json_schema", "schema": inline_schema(wire), "retryCount": 1}
        try:
            value = request(self.runtime, "POST", f"/session/{session}/message", json=body)
        except RuntimeErrorSafe:
            try:
                request(self.runtime, "POST", f"/session/{session}/abort")
            except RuntimeErrorSafe:
                pass
            with db() as conn:
                row = conn.execute("SELECT context FROM opencode_lease WHERE job_id=?", (self.job,)).fetchone()
            if row and json.loads(row["context"]).get("provider_error"):
                raise RuntimeErrorSafe(json.loads(row["context"])["provider_error"]) from None
            raise
        finally:
            if isolated:
                with db() as conn:
                    row = conn.execute("SELECT context FROM opencode_lease WHERE job_id=?", (self.job,)).fetchone()
                    if row:
                        context = json.loads(row["context"])
                        context["sessions"] = [item for item in context["sessions"] if item != session]
                        conn.execute("UPDATE opencode_lease SET context=? WHERE job_id=?", (json.dumps(context), self.job))
                try:
                    request(self.runtime, "DELETE", f"/session/{session}")
                    with db() as conn:
                        conn.execute("DELETE FROM opencode_provider_messages WHERE owner_id=? AND session_id=?", (self.conversation["owner_id"], session))
                except RuntimeErrorSafe:
                    pass
        if value.get("info", {}).get("error"):
            with db() as conn:
                row = conn.execute("SELECT context FROM opencode_lease WHERE job_id=?", (self.job,)).fetchone()
            raise RuntimeErrorSafe(json.loads(row["context"]).get("provider_error", "opencode_generation_failed") if row else "opencode_generation_failed")
        with db() as conn:
            row = lease_row(conn)
        usage = {"input_tokens": row["input_measured"] - before[0], "output_tokens": row["output_measured"] - before[1]}
        if row["calls"] == before[2]:
            raise RuntimeErrorSafe("opencode_gateway_bypassed")
        content = "\n".join(part.get("text", "") for part in value.get("parts", []) if part.get("type") == "text")
        return value, AIMessage(content=content, usage_metadata={**usage, "total_tokens": sum(usage.values())})

    def invoke(self, schema, messages, *, prepared_payload, quote_registry, output_limit, state):
        from agent.research_contract import ReportAudit
        narrative = schema == ReportDraft and prepared_payload.get("writing_format") == "narrative"
        system = messages[0].content + (model_output.NARRATIVE_INSTRUCTION if narrative else model_output.QUOTE_REF_INSTRUCTION)
        wire = None if narrative else model_output.transport_schema(schema, quote_refs=bool(quote_registry), quote_ids=quote_registry)
        if wire and schema in {ReportDraft, VisualDraft}:
            wire["$defs"]["ReportVisual"]["properties"]["section_key"]["enum"] = prepared_payload["section_keys"]
        value, raw = self.prompt(system, json.dumps(prepared_payload, ensure_ascii=False), wire=wire, cap=output_limit, evidence=state["evidence"] if "evidence" in state else [], isolated=schema == ReportAudit)
        try:
            parsed = model_output.parse_narrative(raw.content, quote_registry, prepared_payload["section_keys"]) if narrative else model_output._resolve_quote_refs(value["info"].get("structured", value["info"].get("structured_output")), quote_registry)
            return {"parsed": parsed, "raw": raw}
        except (ValueError, TypeError, model_output.ModelCallError) as exc:
            return {"parsed": None, "raw": raw, "parsing_error": model_output.classify_error(exc)}
