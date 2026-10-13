import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
  MessageCircle,
  Pin,
  Search,
  Send,
  X,
} from "lucide-react";
import { socialChanged, socialRequest } from "./social";
import { useNotebookConfirm } from "./NotebookTools";
import {
  discussionError,
  discussionPath,
  mergeMessages,
  type Channel,
  type ChatMessage,
  type DiscussionScope,
  type MessagePage,
} from "./discussion";
import type { Language } from "./ProductViews";
import "./DiscussionSpace.css";

export type SpaceProps = {
  apiBase: string;
  scope: DiscussionScope;
  language: Language;
  userId: string;
  attachments?: { kind: "page" | "evidence"; id: string; title: string }[];
  onChanged?: () => void | Promise<void>;
};
export function useVisibleRefresh(
  root: RefObject<HTMLElement | null>,
  refresh: () => Promise<void>,
) {
  useEffect(() => {
    let pending = false,
      stopped = false,
      wasVisible = false;
    const visible = () =>
      document.visibilityState !== "hidden" &&
      !!root.current &&
      root.current.offsetParent !== null;
    const tick = async () => {
      wasVisible = visible();
      if (stopped || pending || !wasVisible) return;
      pending = true;
      try {
        await refresh();
      } finally {
        pending = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    const observer = new MutationObserver(() => {
      const next = visible();
      if (next && !wasVisible) void tick();
      wasVisible = next;
    });
    for (
      let element = root.current?.parentElement;
      element;
      element = element.parentElement
    )
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["hidden", "style", "class"],
      });
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      stopped = true;
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [root, refresh]);
}

export function DiscussionSpace({
  apiBase,
  scope,
  language,
  userId,
  attachments = [],
  onChanged,
}: SpaceProps) {
  const vi = language === "vi",
    root = useRef<HTMLElement>(null),
    path = discussionPath(scope),
    epoch = useRef(0),
    locked = useRef(false),
    request = useRef<AbortController | null>(null),
    loaded = useRef(false),
    threadLoaded = useRef(false);
  const [channel, setChannel] = useState<Channel | null>(null),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [replies, setReplies] = useState<ChatMessage[]>([]);
  const [parent, setParent] = useState<ChatMessage | null>(null),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<number | null>(null),
    [replyCursor, setReplyCursor] = useState<number | null>(null),
    [through, setThrough] = useState(0);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        body: string;
        client_id: string;
        mentions: string[];
        attachment: string;
      }
    >
  >({});
  const draftKey = parent?.id || "main",
    draft = drafts[draftKey] || {
      body: "",
      client_id: "",
      mentions: [],
      attachment: "",
    };
  const [edit, setEdit] = useState<{
      message: ChatMessage;
      body: string;
    } | null>(null),
    [conversion, setConversion] = useState<{
      message: ChatMessage;
      kind: "task" | "note";
      title: string;
    } | null>(null);
  const history = useRef({ messages, replies });
  history.current = { messages, replies };
  const [ask, confirmation] = useNotebookConfirm(language);
  const fail = useCallback(
    (reason: unknown) => {
      if ((reason as Error)?.name === "AbortError") return;
      if (
        [401, 403, 404].includes((reason as { status?: number }).status || 0)
      ) {
        setDenied(true);
        setChannel(null);
        setMessages([]);
        setReplies([]);
        setParent(null);
        setDrafts({});
        setEdit(null);
        setConversion(null);
      }
      setError(discussionError(reason, vi));
    },
    [vi],
  );
  const refresh = useCallback(async () => {
    if (denied) return;
    const generation = epoch.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const known = history.current.messages.map((message) => message.id),
      knownReplies = history.current.replies.map((message) => message.id);
    try {
      const [space, page, thread, threadRoot] = await Promise.all([
        socialRequest<Channel>(apiBase, path, { signal: controller.signal }),
        socialRequest<MessagePage>(
          apiBase,
          `${path}/messages?include=${known.join(",")}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
          { signal: controller.signal },
        ),
        parent
          ? socialRequest<MessagePage>(
              apiBase,
              `${path}/messages?parent_id=${parent.id}&include=${knownReplies.join(",")}`,
              { signal: controller.signal },
            )
          : null,
        parent
          ? socialRequest<{ message: ChatMessage }>(
              apiBase,
              `/discussions/messages/${parent.id}`,
              { signal: controller.signal },
            )
          : null,
      ]);
      if (generation !== epoch.current || controller.signal.aborted) return;
      setChannel(space);
      setMessages((old) =>
        mergeMessages(
          old.filter((message) => !known.includes(message.id)),
          [...(page.refreshed || []), ...page.messages],
        ).slice(-200),
      );
      if (!loaded.current) {
        setCursor(page.next_cursor);
        loaded.current = true;
      }
      setThrough(page.through);
      if (thread) {
        setReplies((old) =>
          mergeMessages(
            old.filter((message) => !knownReplies.includes(message.id)),
            [...(thread.refreshed || []), ...thread.messages],
          ).slice(-200),
        );
        if (!threadLoaded.current) {
          setReplyCursor(thread.next_cursor);
          threadLoaded.current = true;
        }
      }
      if (threadRoot) setParent(threadRoot.message);
      setError("");
    } catch (reason) {
      if (generation === epoch.current && !controller.signal.aborted)
        fail(reason);
    }
  }, [apiBase, path, search, parent?.id, denied, fail]);
  useEffect(
    () => () => {
      epoch.current++;
      request.current?.abort();
    },
    [path],
  );
  useVisibleRefresh(root, refresh);
  const run = async (work: () => Promise<void>) => {
    if (locked.current || denied) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
      socialChanged();
    } catch (reason) {
      if ((reason as { status?: number })?.status === 409) await refresh();
      fail(reason);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const updateDraft = (patch: Partial<typeof draft>) =>
    setDrafts((old) => ({
      ...old,
      [draftKey]: { ...draft, ...patch, client_id: crypto.randomUUID() },
    }));
  const openThread = (message: ChatMessage) => {
    epoch.current++;
    request.current?.abort();
    threadLoaded.current = false;
    setReplies([]);
    setReplyCursor(null);
    setParent(message);
    setEdit(null);
    setConversion(null);
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.body.trim()) return;
    const key = draftKey,
      selected = attachments.find(
        (item) => `${item.kind}:${item.id}` === draft.attachment,
      );
    void run(async () => {
      await socialRequest(apiBase, `${path}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: draft.body,
          client_id: draft.client_id || crypto.randomUUID(),
          parent_id: parent?.id || null,
          mention_ids: draft.mentions,
          context_kind: selected?.kind,
          context_id: selected?.id,
        }),
      });
      setDrafts((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      root.current
        ?.querySelector(".discussion-composer details")
        ?.removeAttribute("open");
    });
  };
  const loadOlder = (thread: boolean) =>
    void run(async () => {
      const before = thread ? replyCursor : cursor,
        count = thread ? replies.length : messages.length;
      if (!before) return;
      if (count >= 200) {
        setNotice(
          vi
            ? "Đã mở 200 tin nhắn. Dùng tìm kiếm để thu hẹp lịch sử; không tải tất cả cùng lúc."
            : "200 messages loaded. Use search to narrow the history; it is not loaded all at once.",
        );
        return;
      }
      const page = await socialRequest<MessagePage>(
        apiBase,
        `${path}/messages?before=${before}&limit=${Math.min(40, 200 - count)}${thread ? `&parent_id=${parent!.id}` : search ? `&q=${encodeURIComponent(search)}` : ""}`,
      );
      if (thread) {
        setReplies((old) => mergeMessages(page.messages, old));
        setReplyCursor(page.next_cursor);
      } else {
        setMessages((old) => mergeMessages(page.messages, old));
        setCursor(page.next_cursor);
      }
    });
  const card = (message: ChatMessage, thread = false) => (
    <article
      key={message.id}
      className={`discussion-message${message.deleted ? " is-deleted" : ""}`}
    >
      <header>
        <span className="discussion-avatar" aria-hidden="true">
          {message.author?.display_name.slice(0, 1) || "—"}
        </span>
        <strong>
          {message.author?.display_name ||
            (vi ? "Tin nhắn không khả dụng" : "Message unavailable")}
        </strong>
        <time dateTime={message.created_at}>
          {new Date(message.created_at).toLocaleString(vi ? "vi-VN" : "en-US")}
        </time>
        {message.pinned && (
          <Pin size={14} aria-label={vi ? "Đã ghim" : "Pinned"} />
        )}
      </header>
      <p className="discussion-body">
        {message.deleted
          ? vi
            ? "Tin nhắn đã bị xóa hoặc bị ẩn."
            : "This message was deleted or hidden."
          : message.body}
      </p>
      {!message.deleted && message.context && (
        <a className="discussion-context" href={message.context.href}>
          {message.context.kind === "page" ? "▤" : "↗"} {message.context.title}
        </a>
      )}
      {!message.deleted && (
        <div className="discussion-actions">
          {!thread && (
            <button
              type="button"
              onClick={() =>
                openThread(
                  message.parent_id
                    ? messages.find(
                        (item) => item.id === message.parent_id,
                      ) || {
                        ...message,
                        id: message.parent_id,
                        parent_id: null,
                        body: vi ? "Đang mở thread…" : "Opening thread…",
                      }
                    : message,
                )
              }
            >
              <MessageCircle size={14} />
              {vi ? "Thread" : "Thread"} · {message.reply_count}
            </button>
          )}
          {channel?.can_write && message.author?.id === userId && (
            <button
              type="button"
              onClick={() => setEdit({ message, body: message.body })}
            >
              {vi ? "Sửa" : "Edit"}
            </button>
          )}
          {channel?.can_write &&
            (message.author?.id === userId || channel.access >= 4) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (
                      !(await ask(
                        vi
                          ? "Xóa nội dung tin nhắn? Các phản hồi trong thread vẫn được giữ."
                          : "Remove this message? Thread replies are kept.",
                        {
                          title: vi ? "Xóa tin nhắn" : "Delete message",
                          destructive: true,
                        },
                      ))
                    )
                      return;
                    await socialRequest(
                      apiBase,
                      `/discussions/messages/${message.id}`,
                      {
                        method: "DELETE",
                        body: JSON.stringify({
                          expected_version: message.version,
                        }),
                      },
                    );
                  })
                }
              >
                {vi ? "Xóa" : "Delete"}
              </button>
            )}
          {channel?.can_write && channel.access >= 3 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await socialRequest(
                    apiBase,
                    `/discussions/messages/${message.id}/pin`,
                    {
                      method: "PUT",
                      body: JSON.stringify({ pinned: !message.pinned }),
                    },
                  );
                })
              }
            >
              {message.pinned
                ? vi
                  ? "Bỏ ghim"
                  : "Unpin"
                : vi
                  ? "Ghim"
                  : "Pin"}
            </button>
          )}
          {scope.kind === "project" &&
            channel?.can_write &&
            channel.access >= 3 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setConversion({
                      message,
                      kind: "task",
                      title: message.body.slice(0, 100),
                    })
                  }
                >
                  {vi ? "→ Nhiệm vụ" : "→ Task"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConversion({
                      message,
                      kind: "note",
                      title: message.body.slice(0, 100),
                    })
                  }
                >
                  {vi ? "→ Ghi chú" : "→ Note"}
                </button>
              </>
            )}
        </div>
      )}
      {edit?.message.id === message.id && (
        <form
          className="discussion-inline-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await socialRequest(
                apiBase,
                `/discussions/messages/${message.id}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    body: edit.body,
                    expected_version: edit.message.version,
                  }),
                },
              );
              setEdit(null);
            });
          }}
        >
          <label>
            {vi ? "Nội dung chỉnh sửa" : "Edited content"}
            <textarea
              disabled={busy}
              required
              maxLength={6000}
              value={edit.body}
              onChange={(event) =>
                setEdit({ ...edit, body: event.target.value })
              }
            />
          </label>
          <div>
            <button disabled={busy || !edit.body.trim()}>
              {vi ? "Lưu" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const latest = [...messages, ...replies].find(
                  (item) => item.id === edit.message.id,
                );
                if (latest && !latest.deleted)
                  setEdit({ message: latest, body: latest.body });
              }}
            >
              {vi ? "Tải bản mới (bỏ sửa)" : "Reload latest (discard edits)"}
            </button>
            <button type="button" onClick={() => setEdit(null)}>
              {vi ? "Hủy" : "Cancel"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
  return (
    <section
      ref={root}
      className="discussion-space"
      aria-label={vi ? "Không gian thảo luận" : "Discussion space"}
    >
      <header className="discussion-toolbar">
        <div>
          <h2>{vi ? "Thảo luận" : "Discussion"}</h2>
          <p>
            {vi
              ? "Trao đổi có ngữ cảnh, giữ lại quyết định."
              : "Context-rich conversations and durable decisions."}
          </p>
        </div>
        {channel && (
          <div className="discussion-controls">
            <span>
              {channel.unread_count} {vi ? "chưa đọc" : "unread"}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await socialRequest(apiBase, `${path}/preferences`, {
                    method: "PUT",
                    body: JSON.stringify({ through }),
                  });
                })
              }
            >
              <CheckCheck size={16} />
              {vi ? "Đánh dấu đã đọc" : "Mark read"}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={channel.muted}
              onClick={() =>
                void run(async () => {
                  await socialRequest(apiBase, `${path}/preferences`, {
                    method: "PUT",
                    body: JSON.stringify({ muted: !channel.muted }),
                  });
                })
              }
            >
              {channel.muted ? <BellOff size={16} /> : <Bell size={16} />}
              {channel.muted
                ? vi
                  ? "Bật thông báo"
                  : "Unmute"
                : vi
                  ? "Tắt thông báo"
                  : "Mute"}
            </button>
          </div>
        )}
      </header>
      <p className="discussion-privacy">
        {vi
          ? "Chỉ thông báo @mention và phản hồi; không gửi chat sang AI. Cập nhật mỗi 5 giây khi đang mở. Đánh dấu đã đọc áp dụng cả thread."
          : "Only mentions and replies notify; chat is not sent to AI. Updates every 5 seconds while visible. Mark read includes threads."}
      </p>
      {error && (
        <p role="alert" className="collab-alert is-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {denied ? (
        <button
          type="button"
          onClick={() => {
            setDenied(false);
            setError("");
          }}
        >
          {vi ? "Kiểm tra lại quyền" : "Check access again"}
        </button>
      ) : (
        <>
          <form
            className="discussion-search"
            onSubmit={(event) => {
              event.preventDefault();
              epoch.current++;
              request.current?.abort();
              loaded.current = false;
              setMessages([]);
              setCursor(null);
              setSearch(query.trim());
            }}
          >
            <Search size={17} />
            <input
              aria-label={vi ? "Tìm tin nhắn" : "Search messages"}
              maxLength={120}
              placeholder={
                vi ? "Tìm trong cuộc trò chuyện…" : "Search this conversation…"
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button>{vi ? "Tìm" : "Search"}</button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  epoch.current++;
                  loaded.current = false;
                  setSearch("");
                  setQuery("");
                  setMessages([]);
                  setCursor(null);
                }}
              >
                {vi ? "Xóa tìm kiếm" : "Clear search"}
              </button>
            )}
          </form>
          {!!channel?.pinned.length && (
            <details className="discussion-pins">
              <summary>
                <Pin size={15} />
                {vi ? "Tin nhắn đã ghim" : "Pinned messages"} ·{" "}
                {channel.pinned.length}
              </summary>
              {channel.pinned.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() =>
                    openThread(
                      message.parent_id
                        ? {
                            ...message,
                            id: message.parent_id,
                            parent_id: null,
                            body: vi
                              ? "Thread của tin nhắn đã ghim"
                              : "Pinned message thread",
                          }
                        : message,
                    )
                  }
                >
                  {message.author?.display_name} · {message.body.slice(0, 140)}
                </button>
              ))}
            </details>
          )}
          <div className={`discussion-columns${parent ? " has-thread" : ""}`}>
            <div
              className="discussion-history"
              aria-label={vi ? "Tin nhắn" : "Messages"}
            >
              {cursor && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => loadOlder(false)}
                >
                  {vi ? "Tin nhắn cũ hơn" : "Older messages"}
                </button>
              )}
              {messages.map((message) => card(message))}
              {!messages.length && (
                <p className="discussion-empty">
                  {channel
                    ? vi
                      ? "Chưa có tin nhắn phù hợp. Bắt đầu một cuộc trao đổi bên dưới."
                      : "No matching messages. Start a conversation below."
                    : vi
                      ? "Đang mở cuộc trò chuyện…"
                      : "Opening conversation…"}
                </p>
              )}
            </div>
            {parent && (
              <aside className="discussion-thread">
                <header>
                  <h3>Thread</h3>
                  <button
                    type="button"
                    aria-label={vi ? "Đóng thread" : "Close thread"}
                    onClick={() => {
                      epoch.current++;
                      request.current?.abort();
                      setParent(null);
                      setReplies([]);
                    }}
                  >
                    {<X size={16} />}
                  </button>
                </header>
                {card(parent, true)}
                {replyCursor && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => loadOlder(true)}
                  >
                    {vi ? "Phản hồi cũ hơn" : "Older replies"}
                  </button>
                )}
                {replies.map((message) => card(message, true))}
                {!replies.length && (
                  <p>{vi ? "Chưa có phản hồi." : "No replies yet."}</p>
                )}
              </aside>
            )}
          </div>
          {conversion && (
            <form
              className="discussion-convert"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await socialRequest<{
                    href: string;
                    existing: boolean;
                  }>(
                    apiBase,
                    `/discussions/messages/${conversion.message.id}/convert`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        kind: conversion.kind,
                        title: conversion.title,
                      }),
                    },
                  );
                  setConversion(null);
                  setNotice(
                    result.existing
                      ? vi
                        ? "Mục này đã được tạo từ tin nhắn trước đó."
                        : "This message was already converted."
                      : vi
                        ? "Đã tạo. Mở từ Nhiệm vụ hoặc cây trang của dự án."
                        : "Created. Open it from Tasks or the project page tree.",
                  );
                  try {
                    await onChanged?.();
                  } catch {
                    setNotice(
                      vi
                        ? "Đã tạo, nhưng chưa cập nhật cây trang. Tải lại dự án; không cần tạo lại."
                        : "Created, but the project could not refresh. Reload the project; do not recreate it.",
                    );
                  }
                });
              }}
            >
              <h3>
                {conversion.kind === "task"
                  ? vi
                    ? "Tạo nhiệm vụ từ tin nhắn"
                    : "Create task from message"
                  : vi
                    ? "Tạo ghi chú từ tin nhắn"
                    : "Create note from message"}
              </h3>
              <p>
                {vi
                  ? "Giữ liên kết nguồn trong nhật ký dự án; mỗi tin nhắn chỉ tạo một mục mỗi loại."
                  : "Source attribution is kept in project activity; each message creates one item per type."}
              </p>
              <label>
                {vi ? "Tiêu đề" : "Title"}
                <input
                  disabled={busy}
                  maxLength={120}
                  required
                  value={conversion.title}
                  onChange={(event) =>
                    setConversion({ ...conversion, title: event.target.value })
                  }
                />
              </label>
              <button disabled={busy || !conversion.title.trim()}>
                {vi ? "Tạo" : "Create"}
              </button>
              <button type="button" onClick={() => setConversion(null)}>
                {vi ? "Hủy" : "Cancel"}
              </button>
            </form>
          )}
          {channel?.can_write && !search && (
            <form className="discussion-composer" onSubmit={send}>
              <label>
                {parent
                  ? vi
                    ? "Trả lời trong thread"
                    : "Reply in thread"
                  : vi
                    ? "Tin nhắn mới"
                    : "New message"}
                <textarea
                  disabled={busy}
                  maxLength={6000}
                  rows={3}
                  value={draft.body}
                  onChange={(event) =>
                    updateDraft({ body: event.target.value })
                  }
                  placeholder={
                    vi
                      ? "Chia sẻ ý tưởng, câu hỏi hoặc quyết định…"
                      : "Share an idea, question, or decision…"
                  }
                />
              </label>
              <div className="discussion-composer-tools">
                <details>
                  <summary>@mention</summary>
                  <div className="discussion-mentions">
                    {channel.members
                      .filter((person) => person.id !== userId)
                      .map((person) => (
                        <label key={person.id}>
                          <input
                            type="checkbox"
                            disabled={
                              busy ||
                              (!draft.mentions.includes(person.id) &&
                                draft.mentions.length >= 12)
                            }
                            checked={draft.mentions.includes(person.id)}
                            onChange={(event) =>
                              updateDraft({
                                mentions: event.target.checked
                                  ? [...draft.mentions, person.id]
                                  : draft.mentions.filter(
                                      (id) => id !== person.id,
                                    ),
                                body: event.target.checked
                                  ? `${draft.body}${draft.body ? " " : ""}@${person.public_name || person.display_name} `
                                  : draft.body,
                              })
                            }
                          />
                          {person.display_name}
                        </label>
                      ))}
                  </div>
                </details>
                {attachments.length > 0 && (
                  <select
                    disabled={busy}
                    aria-label={
                      vi
                        ? "Gắn trang hoặc nguồn đã chia sẻ"
                        : "Attach shared page or evidence"
                    }
                    value={draft.attachment}
                    onChange={(event) =>
                      updateDraft({ attachment: event.target.value })
                    }
                  >
                    <option value="">
                      {vi ? "Gắn trang / nguồn" : "Attach page / evidence"}
                    </option>
                    {attachments.map((item) => (
                      <option
                        key={`${item.kind}:${item.id}`}
                        value={`${item.kind}:${item.id}`}
                      >
                        {item.title}
                      </option>
                    ))}
                  </select>
                )}
                <small>{draft.body.length}/6000</small>
                <button disabled={busy || !draft.body.trim()}>
                  <Send size={16} />
                  {vi ? "Gửi" : "Send"}
                </button>
              </div>
            </form>
          )}
          {channel && !channel.can_write && (
            <p className="discussion-privacy">
              {vi
                ? "Chế độ chỉ đọc. Cần quyền bình luận trở lên để gửi."
                : "Read-only. Commenter access or higher is required to send."}
            </p>
          )}
        </>
      )}
      {confirmation}
    </section>
  );
}
