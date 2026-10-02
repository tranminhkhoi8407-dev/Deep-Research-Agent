import { useEffect, useRef, useState } from "react";
import { Check, Link2, Wifi, WifiOff } from "lucide-react";
import * as Y from "yjs";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Language } from "./ProductViews";
import type { Person } from "./CollaborationHub";
import "katex/dist/katex.min.css";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export default function LegacyMarkdownEditor({
  apiBase,
  pageId,
  userId,
  canEdit,
  language,
  onReady,
  onSync,
  operation,
}: {
  apiBase: string;
  pageId: string;
  userId: string;
  canEdit: boolean;
  language: Language;
  onReady: (text: string) => void;
  onSync: (ready: boolean) => void;
  operation: { id: number; mode: "append" | "replace"; content: string } | null;
}) {
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presence, setPresence] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const docRef = useRef<Y.Doc | null>(null);
  const textRef = useRef<Y.Text | null>(null);
  const editorMountRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const onSyncRef = useRef(onSync);
  const languageRef = useRef(language);
  const appliedOperationRef = useRef(0);
  onReadyRef.current = onReady;
  onSyncRef.current = onSync;
  languageRef.current = language;

  useEffect(() => {
    if (!editorMountRef.current) return;
    let disposed = false;
    let writable = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let queued: Uint8Array[] = [];
    const pending = new Set<string>();
    const draftKey = `nexora-live-draft:${userId}:${pageId}`;
    const doc = new Y.Doc();
    const shared = doc.getText("markdown");
    docRef.current = doc;
    textRef.current = shared;
    reconnectCountRef.current = 0;
    setContent("");
    setReady(false);
    setConnected(false);
    setPresence([]);
    setError("");
    setSaving(false);
    onSyncRef.current(false);
    const syncText = () => {
      const value = shared.toString();
      setContent(value);
      onReadyRef.current(value);
    };
    shared.observe(syncText);
    const persistDraft = () => {
      try {
        sessionStorage.setItem(draftKey, toBase64(Y.encodeStateAsUpdate(doc)));
      } catch {
        /* The in-memory document still survives reconnects. */
      }
    };
    const flush = () => {
      flushTimer = null;
      if (
        !queued.length ||
        socketRef.current?.readyState !== WebSocket.OPEN ||
        !writable
      )
        return;
      const id = crypto.randomUUID();
      const data = toBase64(Y.mergeUpdates(queued));
      queued = [];
      pending.add(id);
      socketRef.current.send(JSON.stringify({ type: "update", id, data }));
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      queued.push(update);
      setSaving(true);
      onSyncRef.current(false);
      persistDraft();
      if (!flushTimer) flushTimer = setTimeout(flush, 120);
    };
    doc.on("update", onUpdate);
    const editing = new Compartment();
    const undoManager = new Y.UndoManager(shared, {
      trackedOrigins: new Set(["local"]),
    });
    const view = new EditorView({
      doc: shared.toString(),
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label":
            languageRef.current === "vi"
              ? "Nội dung trang nghiên cứu"
              : "Research page content",
        }),
        Prec.highest(
          keymap.of(
            yUndoManagerKeymap.map((binding) => ({
              ...binding,
              run: (editor: EditorView) =>
                writable ? binding.run?.(editor) || false : true,
            })),
          ),
        ),
        Prec.highest(
          EditorView.domEventHandlers({
            beforeinput: (event) =>
              !writable &&
              (event.inputType === "historyUndo" ||
                event.inputType === "historyRedo"),
          }),
        ),
        editing.of([
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
        ]),
        yCollab(shared, null, { undoManager }),
      ],
      parent: editorMountRef.current,
    });
    editorViewRef.current = view;
    const openSocket = async () => {
      if (disposed) return;
      // A rejected WebSocket handshake exposes only code 1006 in browsers.
      // Check the HTTP endpoint on retries to distinguish expiry from outages.
      if (reconnectCountRef.current > 0) {
        try {
          const response = await fetch(
            `${apiBase}/api/collab/pages/${encodeURIComponent(pageId)}`,
            { credentials: "include" },
          );
          if ([401, 403, 404].includes(response.status)) {
            if (!disposed)
              setError(
                languageRef.current === "vi"
                  ? "Phiên hoặc quyền truy cập đã hết hiệu lực. Hãy đăng nhập lại hoặc liên hệ quản lý dự án."
                  : "Session or access has expired. Sign in again or contact the project manager.",
              );
            return;
          }
        } catch {
          // Network recovery remains automatic; editing stays locked meanwhile.
        }
        if (disposed) return;
      }
      const url = `${(apiBase || window.location.origin).replace(/^http/, "ws")}/api/collab/pages/${encodeURIComponent(pageId)}/live`;
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        if (!disposed) {
          setConnected(true);
          socket.send(JSON.stringify({ type: "presence" }));
        }
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data) as {
            type: string;
            data?: string;
            people?: Person[];
            message?: string;
            access?: number;
            id?: string;
          };
          if (message.type === "update" && message.data) {
            Y.applyUpdate(doc, fromBase64(message.data), "remote");
          }
          if (message.type === "ready") {
            setError("");
            writable = canEdit && (message.access || 0) >= 3;
            if (writable) {
              try {
                const draft = sessionStorage.getItem(draftKey);
                if (draft) Y.applyUpdate(doc, fromBase64(draft), "recovery");
              } catch {
                setError(
                  languageRef.current === "vi"
                    ? "Không khôi phục được bản nháp cục bộ."
                    : "Could not recover the local draft.",
                );
              }
              if (
                queued.length ||
                pending.size ||
                reconnectCountRef.current > 0
              ) {
                queued = [Y.encodeStateAsUpdate(doc)];
                pending.clear();
                setSaving(true);
                flush();
              }
            }
            view.dispatch({
              effects: editing.reconfigure([
                EditorView.editable.of(writable),
                EditorState.readOnly.of(!writable),
              ]),
            });
            setReady(true);
            if (!queued.length && !pending.size) {
              setSaving(false);
              onSyncRef.current(true);
            }
            reconnectCountRef.current = 0;
          }
          if (message.type === "permission") {
            writable = canEdit && (message.access || 0) >= 3;
            view.dispatch({
              effects: editing.reconfigure([
                EditorView.editable.of(writable),
                EditorState.readOnly.of(!writable),
              ]),
            });
            if (!writable)
              setError(
                languageRef.current === "vi"
                  ? "Quyền chỉnh sửa đã được thu hồi. Bạn vẫn có thể đọc và xuất nội dung."
                  : "Editing access was revoked. You can still read and export this page.",
              );
          }
          if (message.type === "ack" && message.id) {
            pending.delete(message.id);
            if (!pending.size && !queued.length) {
              setSaving(false);
              onSyncRef.current(true);
              try {
                sessionStorage.removeItem(draftKey);
              } catch {
                /* Optional recovery storage. */
              }
            }
          }
          if (message.type === "presence") setPresence(message.people || []);
          if (message.type === "error")
            setError(message.message || "Live update rejected");
        } catch {
          setError(
            languageRef.current === "vi"
              ? "Không thể đọc cập nhật realtime."
              : "Could not read live update.",
          );
        }
      };
      socket.onclose = (event) => {
        if (disposed) return;
        writable = false;
        setConnected(false);
        setReady(false);
        onSyncRef.current(false);
        view.dispatch({
          effects: editing.reconfigure([
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ]),
        });
        if (event.code === 4401 || event.code === 4403) {
          setError(
            languageRef.current === "vi"
              ? "Phiên hoặc quyền truy cập đã hết hiệu lực."
              : "Session or access has expired.",
          );
          return;
        }
        reconnectCountRef.current += 1;
        reconnectRef.current = setTimeout(
          () => void openSocket(),
          Math.min(1500 * 2 ** (reconnectCountRef.current - 1), 15_000),
        );
      };
      socket.onerror = () => {
        if (!disposed)
          setError(
            languageRef.current === "vi"
              ? "Mất kết nối. Đang thử lại…"
              : "Connection lost. Retrying…",
          );
      };
    };
    void openSocket();
    const beforeLeave = (event: BeforeUnloadEvent) => {
      if (queued.length || pending.size) {
        persistDraft();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeLeave);
    const heartbeat = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN)
        socketRef.current.send(JSON.stringify({ type: "presence" }));
    }, 10_000);
    return () => {
      disposed = true;
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", beforeLeave);
      if (queued.length || pending.size) persistDraft();
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
      view.destroy();
      undoManager.destroy();
      editorViewRef.current = null;
      shared.unobserve(syncText);
      doc.off("update", onUpdate);
      doc.destroy();
      docRef.current = null;
      textRef.current = null;
    };
  }, [apiBase, pageId, userId, canEdit]);

  const changeText = (next: string) => {
    const shared = textRef.current,
      doc = docRef.current;
    if (
      !shared ||
      !doc ||
      !ready ||
      !canEdit ||
      editorViewRef.current?.state.readOnly
    )
      return;
    const previous = shared.toString();
    let prefix = 0;
    while (
      prefix < previous.length &&
      prefix < next.length &&
      previous[prefix] === next[prefix]
    )
      prefix++;
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;
    doc.transact(() => {
      if (previous.length - prefix - suffix)
        shared.delete(prefix, previous.length - prefix - suffix);
      if (next.length - prefix - suffix)
        shared.insert(prefix, next.slice(prefix, next.length - suffix));
    }, "local");
  };

  useEffect(() => {
    if (
      !operation ||
      !ready ||
      !canEdit ||
      operation.id === appliedOperationRef.current ||
      !textRef.current
    )
      return;
    appliedOperationRef.current = operation.id;
    const current = textRef.current.toString();
    changeText(
      operation.mode === "replace"
        ? operation.content
        : `${current}${current ? "\n\n" : ""}${operation.content}`,
    );
  }, [operation, ready, canEdit]);

  const insert = (before: string, after = "") => {
    const view = editorViewRef.current;
    if (!view || !ready || !canEdit || view.state.readOnly) return;
    const selection = view.state.selection.main;
    const selected = view.state.doc.sliceString(selection.from, selection.to);
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: before + selected + after,
      },
      selection: {
        anchor: selection.from + before.length,
        head: selection.from + before.length + selected.length,
      },
    });
    view.focus();
  };

  return (
    <div className="collab-editor">
      <div className="collab-editor__toolbar">
        <div>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Heading"
            onClick={() => insert("\n## ")}
          >
            H2
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Bold"
            onClick={() => insert("**", "**")}
          >
            B
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Bullet list"
            onClick={() => insert("\n- ")}
          >
            •
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Table"
            onClick={() =>
              insert("\n| Column | Evidence |\n| --- | --- |\n| | |\n")
            }
          >
            ▦
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Checklist"
            onClick={() => insert("\n- [ ] ")}
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="LaTeX"
            onClick={() => insert("\n$$\n", "\n$$\n")}
          >
            ∑ LaTeX
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Citation"
            onClick={() => insert("[", "](https://doi.org/)")}
          >
            <Link2 size={15} />
          </button>
          <button
            type="button"
            disabled={!canEdit || !ready}
            title="Code"
            onClick={() => insert("\n```\n", "\n```\n")}
          >
            {"</>"}
          </button>
        </div>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview((value) => !value)}
        >
          {preview
            ? language === "vi"
              ? "Soạn thảo"
              : "Edit"
            : language === "vi"
              ? "Xem trước"
              : "Preview"}
        </button>
      </div>
      <div className="collab-editor__status">
        <span className={connected && ready ? "is-live" : ""}>
          {connected && ready ? <Wifi size={15} /> : <WifiOff size={15} />}
          {connected && ready
            ? saving
              ? language === "vi"
                ? "Đang lưu…"
                : "Saving…"
              : language === "vi"
                ? "Đã đồng bộ"
                : "All changes synced"
            : language === "vi"
              ? "Đang kết nối…"
              : "Connecting…"}
        </span>
        <span>
          {presence.length} {language === "vi" ? "người đang xem" : "viewing"}
        </span>
        {presence.slice(0, 4).map((person) => (
          <span
            className="collab-editor__presence"
            key={person.id}
            title={person.display_name}
          >
            {person.display_name.slice(0, 1)}
          </span>
        ))}
      </div>
      {error && (
        <p className="collab-inline-error" role="alert">
          {error}
        </p>
      )}
      <div
        ref={editorMountRef}
        className="collab-codemirror"
        style={{ display: preview ? "none" : undefined }}
        aria-label={
          language === "vi"
            ? "Nội dung trang nghiên cứu"
            : "Research page content"
        }
      />
      {preview && (
        <div className="collab-editor__preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {content ||
              (language === "vi"
                ? "*Trang này chưa có nội dung.*"
                : "*This page is empty.*")}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
