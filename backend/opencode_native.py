"""Chat-Completions transport for the SAME model already configured in Nexora.

OpenCode owns the agent loop; this adapter executes one bounded model call.
No tool is executed here. Provider-specific tool/thought metadata stays scoped
to the owner, OpenCode session and pinned model, including across restarts.
"""
import asyncio
import hashlib
import json
import time
import uuid

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from backend.research_chat_store import db, cancelled

MODEL_ID = "nexora-configured"
TOOL_NAMES = {"nexora_evidence_search", "nexora_evidence_read", "StructuredOutput"}


class NativeAdapterError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def configured_llm():
    from agent.nodes import get_llm
    return get_llm()


def binding_for(llm):
    kind = str(getattr(llm, "_llm_type", ""))
    module = type(llm).__module__
    provider = "gemini" if "google" in kind or "google_genai" in module else "groq" if "groq" in kind or "groq" in module else "openai" if "openai" in kind or "openai" in module else None
    model = getattr(llm, "model", None) or getattr(llm, "model_name", None)
    if not provider or not isinstance(model, str) or not model or len(model) > 200:
        raise NativeAdapterError("opencode_native_configuration")
    binding = {"provider": provider, "model": model}
    routing = {field: str(getattr(llm, field)) for field in ("openai_api_base", "base_url", "vertexai", "project", "location") if getattr(llm, field, None) is not None}
    if routing:
        # Changing an endpoint must not silently send the session to a different
        # recipient merely because it advertises the same provider/model name.
        binding["endpoint_fingerprint"] = hashlib.sha256(json.dumps(routing, sort_keys=True).encode()).hexdigest()
    return binding


def current_binding():
    try:
        return binding_for(configured_llm())
    except NativeAdapterError:
        raise
    except Exception:
        raise NativeAdapterError("opencode_native_configuration") from None


def binding_label(binding):
    return f"Nexora · {binding['provider']} · {binding['model']}"


def plain_text(content):
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list) and all(isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str) for part in content):
        return "\n".join(part["text"] for part in content)
    # In particular: never let foreign image/file URLs cause a provider to fetch
    # arbitrary network resources. Paper images require a separate, owned route.
    raise NativeAdapterError("opencode_unsupported_content")


def metadata_for(context, session, calls):
    if not calls:
        return None
    with db() as conn:
        row = conn.execute("SELECT payload,binding FROM opencode_provider_messages WHERE owner_id=? AND session_id=? AND call_id=?", (context["owner"], session, calls[0]["id"])).fetchone()
    if not row or json.loads(row["binding"]) != context["binding"]:
        raise NativeAdapterError("opencode_tool_history_unavailable")
    value = json.loads(row["payload"])
    if [item["id"] for item in value["tool_calls"]] != [item["id"] for item in calls] or value["tool_calls"] != calls:
        raise NativeAdapterError("opencode_invalid_tool_history")
    return value


def convert_messages(raw, context, session):
    if not isinstance(raw, list) or not 1 <= len(raw) <= 500:
        raise NativeAdapterError("opencode_invalid_messages")
    messages, pending, names = [], set(), {}
    for item in raw:
        if not isinstance(item, dict):
            raise NativeAdapterError("opencode_invalid_messages")
        role, content = item.get("role"), plain_text(item.get("content"))
        if role in {"system", "developer", "user", "assistant"} and pending:
            raise NativeAdapterError("opencode_invalid_tool_history")
        if role in {"system", "developer"}:
            messages.append(SystemMessage(content=content))
        elif role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            calls = []
            for call in item.get("tool_calls") or []:
                fn = call.get("function", {}) if isinstance(call, dict) else {}
                identifier = call.get("id") if isinstance(call, dict) else None
                if not isinstance(call, dict) or call.get("type") != "function" or fn.get("name") not in TOOL_NAMES or not isinstance(identifier, str) or not 1 <= len(identifier) <= 200 or identifier in names:
                    raise NativeAdapterError("opencode_invalid_tool_history")
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except (ValueError, TypeError):
                    raise NativeAdapterError("opencode_invalid_tool_history") from None
                if not isinstance(args, dict):
                    raise NativeAdapterError("opencode_invalid_tool_history")
                names[identifier] = fn["name"]
                pending.add(identifier)
                calls.append({"id": identifier, "name": fn["name"], "args": args, "type": "tool_call"})
            saved = metadata_for(context, session, calls)
            messages.append(AIMessage(content=saved["content"] if saved else content, tool_calls=calls, additional_kwargs=saved["additional_kwargs"] if saved else {}))
        elif role == "tool":
            identifier = item.get("tool_call_id")
            if identifier not in pending:
                raise NativeAdapterError("opencode_invalid_tool_history")
            pending.remove(identifier)
            messages.append(ToolMessage(content=content, tool_call_id=identifier, name=names[identifier]))
        else:
            raise NativeAdapterError("opencode_invalid_messages")
    if pending or not messages or not isinstance(messages[-1], (HumanMessage, ToolMessage)):
        raise NativeAdapterError("opencode_invalid_messages")
    return messages


def tools_for(payload):
    tools = payload.get("tools") or []
    if not isinstance(tools, list) or len(tools) > 3:
        raise NativeAdapterError("opencode_invalid_tools")
    seen = set()
    for tool in tools:
        fn = tool.get("function", {}) if isinstance(tool, dict) else {}
        if not isinstance(tool, dict) or tool.get("type") != "function" or fn.get("name") not in TOOL_NAMES or fn["name"] in seen or not isinstance(fn.get("parameters"), dict):
            raise NativeAdapterError("opencode_invalid_tools")
        seen.add(fn["name"])
    choice = payload.get("tool_choice")
    if choice is not None and choice not in ("auto", "required", "none"):
        if not isinstance(choice, dict) or choice.get("type") != "function" or choice.get("function", {}).get("name") not in seen:
            raise NativeAdapterError("opencode_invalid_tools")
    return tools, choice, seen


def bounded_model(llm, cap, seconds):
    if not hasattr(llm, "model_copy") or not hasattr(llm, "ainvoke"):
        raise NativeAdapterError("opencode_native_configuration")
    fields = getattr(type(llm), "model_fields", {})
    token_field = "max_output_tokens" if "max_output_tokens" in fields else "max_tokens"
    changes = {token_field: cap, "max_retries": 0}
    if hasattr(llm, "timeout"):
        changes["timeout"] = seconds
    if hasattr(llm, "request_timeout"):
        changes["request_timeout"] = seconds
    return llm.model_copy(update=changes)


def response_text(message):
    if isinstance(message.content, str):
        return message.content
    # Thought/reasoning blocks and signatures are not public prose. Keep their
    # original metadata in the backend only when needed to replay tool calls.
    return "\n".join(part.get("text", "") for part in message.content if isinstance(part, dict) and part.get("type") == "text" and not part.get("thought") and not part.get("extras", {}).get("thought"))


def store_tool_response(message, context, session):
    calls = message.tool_calls
    if not calls:
        return
    try:
        value = message.model_dump(mode="json", include={"content", "additional_kwargs", "tool_calls"})
        payload = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        raise NativeAdapterError("opencode_tool_metadata_invalid") from None
    if len(payload.encode()) > 400000:
        raise NativeAdapterError("opencode_tool_metadata_invalid")
    with db() as conn:
        for call in calls:
            conn.execute("INSERT INTO opencode_provider_messages(owner_id,session_id,call_id,binding,payload,created_at) VALUES(?,?,?,?,?,?)", (context["owner"], session, call["id"], json.dumps(context["binding"]), payload, time.time()))


async def completion(payload, context, session, job, cap, deadline):
    llm = configured_llm()
    if binding_for(llm) != context.get("binding"):
        raise NativeAdapterError("opencode_configured_model_changed")
    messages = convert_messages(payload["messages"], context, session)
    if context.get('chat_images'):
        from backend.chat_attachments import image_supported
        if not image_supported():
            raise NativeAdapterError('attachment_image_not_supported')
        # The gateway context is created from owner-checked attachment records,
        # not payload content. Existing foreign image URLs remain forbidden.
        human = next((item for item in reversed(messages) if isinstance(item, HumanMessage)), None)
        if human is None:
            raise NativeAdapterError('opencode_invalid_messages')
        human.content = [{'type': 'text', 'text': human.content}, *context['chat_images']]
    tools, choice, names = tools_for(payload)
    seconds = min(60, deadline - time.time())
    if seconds <= 0 or cancelled(job):
        raise NativeAdapterError("cancelled")
    runnable = bounded_model(llm, cap, seconds)
    if tools:
        kwargs = {"tool_choice": choice} if choice is not None else {}
        runnable = runnable.bind_tools(tools, **kwargs)
    task = asyncio.create_task(runnable.ainvoke(messages))
    call_deadline = min(deadline, time.time() + seconds)
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=.25)
            if cancelled(job) or time.time() >= call_deadline:
                raise NativeAdapterError("cancelled" if cancelled(job) else "opencode_native_timeout")
        message = await task
    except NativeAdapterError:
        raise
    except Exception as exc:
        from agent.model_output import classify_error
        kind = classify_error(exc).kind
        code = {"rate_limit": "opencode_capacity", "authentication": "opencode_native_authentication", "timeout": "opencode_native_timeout"}.get(kind, "opencode_native_generation_failed")
        raise NativeAdapterError(code) from None
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    if cancelled(job):
        raise NativeAdapterError("cancelled")
    if message.invalid_tool_calls:
        raise NativeAdapterError("opencode_invalid_tool_call")
    calls = []
    for call in message.tool_calls:
        if call["name"] not in names or not isinstance(call.get("args"), dict):
            raise NativeAdapterError("opencode_invalid_tool_call")
        if not call.get("id"):
            call["id"] = "call_" + uuid.uuid4().hex
        calls.append({"id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": json.dumps(call["args"], ensure_ascii=False)}})
    store_tool_response(message, context, session)
    text = response_text(message)
    if not calls and not text.strip():
        raise NativeAdapterError("empty_response")
    usage = message.usage_metadata or {}
    finish = "tool_calls" if calls else "length" if str(message.response_metadata.get("finish_reason", "")).upper() in {"MAX_TOKENS", "LENGTH"} else "stop"
    return {"id": "chatcmpl_" + uuid.uuid4().hex, "object": "chat.completion", "created": int(time.time()), "model": MODEL_ID,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text or None, **({"tool_calls": calls} if calls else {})}, "finish_reason": finish}],
            "usage": {"prompt_tokens": usage.get("input_tokens", 0), "completion_tokens": usage.get("output_tokens", 0), "total_tokens": usage.get("total_tokens", 0)}}


async def sse(value):
    """Buffered completion, streamed in the format expected by OpenCode's SDK.

No claim of incremental provider-token streaming. Tool JSON is emitted whole,
which avoids invalid partial arguments and keeps signatures solely server-side.
"""
    choice = value["choices"][0]
    message = choice["message"]
    delta = {"role": "assistant"}
    if message.get("content"):
        delta["content"] = message["content"]
    if message.get("tool_calls"):
        delta["tool_calls"] = [{"index": index, **call} for index, call in enumerate(message["tool_calls"])]
    base = {k: value[k] for k in ("id", "created", "model")}
    base["object"] = "chat.completion.chunk"
    for event in ({**base, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                  {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}], "usage": value["usage"]}):
        yield ("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode()
    yield b"data: [DONE]\n\n"
