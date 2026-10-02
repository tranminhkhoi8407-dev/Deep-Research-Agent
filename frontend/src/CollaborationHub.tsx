import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FolderPlus,
  History,
  Link2,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import type { AuthUser } from "./Auth";
import type { Language, StoredReportSummary } from "./ProductViews";
import { researchTemplate } from "./ResearchTemplates";
import { NotebookTree, NotebookSearch, NotebookSources, NotebookBrief, useNotebookConfirm, type NotebookReferences } from "./NotebookTools";
import type { NotebookBlock, NotebookOperation } from "./LiveResearchEditor";
import type { DomainResearchPayload } from "./DomainHub";
import "./CollaborationHub.css";

const LiveEditor = lazy(() => import("./LiveResearchEditor"));

type FieldId =
  | "mathematics"
  | "physics"
  | "chemistry"
  | "biology"
  | "artificial-intelligence";
export type Person = {
  id: string;
  public_name: string | null;
  display_name: string;
  avatar_url: string | null;
};
type PendingInvite = { id: string; role: string; recipient: Person };
type Group = {
  id: string;
  name: string;
  description: string;
  my_role: "owner" | "admin" | "member";
  members: (Person & { role: string })[];
  pending_invites: PendingInvite[];
};
type Project = {
  id: string;
  name: string;
  description: string;
  field: FieldId;
  category: string;
  group_id: string | null;
  status: string;
  visibility: string;
  my_access: number;
  updated_at: string;
};
type Page = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  my_access?: number;
  updated_at: string;
};
type SharedPage = Page & {
  project_name: string;
  field: FieldId;
  share_role: string;
};
type Invitation = {
  id: string;
  kind: "group" | "project" | "page";
  target_id: string;
  target_title: string;
  role: string;
  sender: Person;
};
type Connection = {
  id: string;
  status: string;
  direction: "incoming" | "outgoing";
  person: Person;
};
type Task = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  assignee: Person | null;
};
type Evidence = {
  id: string;
  title: string;
  url: string;
  doi: string;
  note: string;
};
type Comment = { id: string; body: string; created_at: string; author: Person };
type Version = {
  id: string;
  label: string;
  created_at: string;
  author: Person;
};
type ProjectDetail = {
  project: Project;
  pages: Page[];
  archived_pages: { id: string; title: string; archived_at: string }[];
  tasks: Task[];
  evidence: Evidence[];
  members: (Person & { role: string })[];
  assignable: Person[];
  pending_invites: PendingInvite[];
};
type ArchivedGroup = { id: string; name: string; archived_at: string };
type PageDetail = {
  page: Page & { my_access: number; can_manage: boolean };
  project: {
    id: string;
    name: string;
    field: FieldId;
    group_id: string | null;
    my_access: number;
  };
  comments: Comment[];
  versions: Version[];
  shares: (Person & { role: string })[];
  pending_invites: PendingInvite[];
};
type Tab = "projects" | "groups" | "people" | "inbox";

const fields: { id: FieldId; vi: string; en: string; glyph: string }[] = [
  { id: "mathematics", vi: "Toán học", en: "Mathematics", glyph: "Σ" },
  { id: "physics", vi: "Vật lý", en: "Physics", glyph: "Φ" },
  { id: "chemistry", vi: "Hóa học", en: "Chemistry", glyph: "⚗" },
  { id: "biology", vi: "Sinh học", en: "Biology", glyph: "◎" },
  {
    id: "artificial-intelligence",
    vi: "Trí tuệ nhân tạo",
    en: "Artificial intelligence",
    glyph: "✧",
  },
];

async function api<T>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${base}/api/collab${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      detail = typeof data.detail === "string" ? data.detail : detail;
    } catch {
      /* Keep fallback. */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function date(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function fieldName(value: FieldId, language: Language) {
  const field = fields.find((item) => item.id === value);
  return field ? field[language] : value;
}

function PersonChip({ person }: { person: Person }) {
  return (
    <span className="collab-person">
      <span className="collab-person__avatar">
        {person.avatar_url ? (
          <img src={person.avatar_url} alt="" />
        ) : (
          person.display_name.slice(0, 1).toUpperCase()
        )}
      </span>
      <span>
        <strong>{person.display_name}</strong>
        <small>{person.public_name || "—"}</small>
      </span>
    </span>
  );
}

function PendingInvitations({
  apiBase,
  language,
  invitations,
  onChanged,
}: {
  apiBase: string;
  language: Language;
  invitations: PendingInvite[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!invitations.length) return null;
  return (
    <div className="collab-pending">
      <h4>{language === "vi" ? "Lời mời đã gửi" : "Sent invitations"}</h4>
      {invitations.map((item) => (
        <div className="collab-member" key={item.id}>
          <PersonChip person={item.recipient} />
          <small>{item.role}</small>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(apiBase, `/invites/${item.id}`, { method: "DELETE" })
                .then(onChanged)
                .catch((reason: Error) => setError(reason.message))
                .finally(() => setBusy(false));
            }}
          >
            {language === "vi" ? "Hủy mời" : "Cancel"}
          </button>
        </div>
      ))}
      {error && (
        <p className="collab-inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: filename.endsWith(".json") ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PageView({
  apiBase,
  pageId,
  language,
  user,
  reports,
  onBack,
  onOpen,
  onPrepareResearch,
}: {
  apiBase: string;
  pageId: string;
  language: Language;
  user: AuthUser;
  reports: StoredReportSummary[];
  onBack: (projectId?: string) => void;
  onOpen: (pageId: string) => void;
  onPrepareResearch: (payload: DomainResearchPayload) => void;
}) {
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [body, setBody] = useState("");
  const [blocks, setBlocks] = useState<NotebookBlock[]>([]);
  const [references, setReferences] = useState<NotebookReferences>({ pages: [], evidence: [], backlinks: [] });
  const [synced, setSynced] = useState(false);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "viewer" | "commenter" | "editor"
  >("editor");
  const [versionLabel, setVersionLabel] = useState("");
  const [templateKind, setTemplateKind] = useState<"study" | "paper">("study");
  const [operation, setOperation] = useState<NotebookOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmNotebook, notebookConfirmation] = useNotebookConfirm(language);
  const [openPanel, setOpenPanel] = useState<
    "discussion" | "sharing" | "history" | "sources"
  >("sources");
  const refreshReferences = useCallback(async () => {
    setReferences(await api<NotebookReferences>(apiBase, `/pages/${pageId}/references`));
  }, [apiBase, pageId]);
  const refresh = useCallback(async () => {
    const result = await api<PageDetail>(apiBase, `/pages/${pageId}`);
    setDetail(result);
    setTitle(result.page.title);
    await refreshReferences();
  }, [apiBase, pageId, refreshReferences]);
  useEffect(() => {
    void refresh().catch((reason: Error) => setError(reason.message));
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void api<PageDetail>(apiBase, `/pages/${pageId}`)
          .then(async result => { setDetail(result); await refreshReferences(); })
          .catch((reason: Error) => setError(reason.message));
    }, 8_000);
    return () => clearInterval(timer);
  }, [apiBase, pageId, refreshReferences]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const saveTitle = () => {
    if (!detail || !title.trim() || title.trim() === detail.page.title) return;
    void act(async () => {
      await api(apiBase, `/pages/${pageId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() }),
      });
      await refresh();
    });
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!inviteName.trim()) return;
    void act(async () => {
      await api(apiBase, `/pages/${pageId}/invites`, {
        method: "POST",
        body: JSON.stringify({ username: inviteName.trim(), role: inviteRole }),
      });
      setInviteName("");
      await refresh();
      setMessage(
        language === "vi"
          ? "Đã gửi lời mời. Người nhận cần chấp nhận trước khi truy cập."
          : "Invitation sent. Access begins after acceptance.",
      );
    });
  };
  const addComment = (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    void act(async () => {
      await api(apiBase, `/pages/${pageId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment.trim() }),
      });
      setComment("");
      await refresh();
    });
  };
  const saveVersion = () => {
    void act(async () => {
      await api(apiBase, `/pages/${pageId}/versions`, {
        method: "POST",
        body: JSON.stringify({
          label:
            versionLabel.trim() ||
            (language === "vi" ? "Bản lưu thủ công" : "Manual snapshot"),
          markdown: body,
          blocks: blocks.length ? blocks : undefined,
        }),
      });
      setVersionLabel("");
      await refresh();
      setMessage(language === "vi" ? "Đã lưu phiên bản." : "Version saved.");
    });
  };
  const restoreVersion = async (version: Version) => {
    if (
      !await confirmNotebook(
        language === "vi"
          ? `Khôi phục nội dung từ ${version.label}? Thay đổi áp dụng cho mọi người đang mở trang; nên thống nhất tạm ngừng sửa trước. Nội dung hiện tại sẽ được lưu một phiên bản trước khi thay.`
          : `Restore content from ${version.label}? This affects everyone on the page; agree to pause editing first. The current content will be snapshotted before replacement.`,
      )
    )
      return;
    void act(async () => {
      await api(apiBase, `/pages/${pageId}/versions`, {
        method: "POST",
        body: JSON.stringify({ label: "Before restore", markdown: body, blocks: blocks.length ? blocks : undefined }),
      });
      const result = await api<{ version: { markdown: string; blocks: NotebookBlock[] | null } }>(
        apiBase,
        `/pages/${pageId}/versions/${version.id}`,
      );
      setOperation({
        id: Date.now(),
        mode: "replace",
        content: result.version.markdown,
        blocks: result.version.blocks || undefined,
      });
      await refresh();
    });
  };
  const importScratchpad = async () => {
    if (!detail || detail.page.my_access < 3) return;
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("deep-research-domain-workspace") || "{}",
      ) as Record<string, { notes?: string }>;
      const note = saved[detail.project.field]?.notes?.trim();
      if (!note) {
        setMessage(
          language === "vi"
            ? "Không có ghi chú cục bộ cho lĩnh vực này."
            : "No local note for this field.",
        );
        return;
      }
      if (
        await confirmNotebook(
          language === "vi"
            ? "Chép ghi chú cá nhân vào trang dùng chung? Bản gốc trên máy vẫn được giữ."
            : "Copy your private field note into this shared page? The local original is kept.",
        )
      )
        setOperation({
          id: Date.now(),
          mode: "append",
          content: `## ${language === "vi" ? "Ghi chú từ Fields" : "Notes from Fields"}\n\n${note}`,
        });
    } catch {
      setError(
        language === "vi"
          ? "Không đọc được ghi chú cục bộ."
          : "Could not read local note.",
      );
    }
  };
  const importReport = async (report: StoredReportSummary) => {
    if (
      !await confirmNotebook(
        language === "vi"
          ? `Chép báo cáo “${report.title}” vào trang nhóm? Nội dung này sẽ được chia sẻ với người có quyền truy cập.`
          : `Copy “${report.title}” into this shared page? Its content will be visible to page members.`,
      )
    )
      return;
    void act(async () => {
      const response = await fetch(
        `${apiBase}/api/reports/${encodeURIComponent(report.id)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Could not read report");
      const item = (await response.json()) as { final_report: string };
      setOperation({
        id: Date.now(),
        mode: "append",
        content: item.final_report,
      });
    });
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}${window.location.pathname}#/collab/page/${pageId}`,
    );
    setMessage(
      language === "vi"
        ? "Đã sao chép link. Chỉ người được cấp quyền mới mở được."
        : "Link copied. Only invited people can open it.",
    );
  };
  const archivePage = async () => {
    if (
      !await confirmNotebook(
        language === "vi"
          ? "Lưu trữ trang này? Quản lý dự án có thể khôi phục về sau."
          : "Archive this page? A project manager can restore it later.",
      )
    )
      return;
    void act(async () => {
      await api(apiBase, `/pages/${pageId}/archive`, { method: "POST" });
      onBack(detail?.project.id);
    });
  };
  const canEdit = (detail?.page.my_access || 0) >= 3;
  const canComment = (detail?.page.my_access || 0) >= 2;
  if (!detail)
    return (
      <section className="collab-card collab-page-loading">
        <button type="button" onClick={() => onBack()}>
          <ArrowLeft size={16} />
          {language === "vi" ? "Quay lại" : "Back"}
        </button>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p>
            <LoaderCircle className="spin" size={18} />
            {language === "vi" ? "Đang mở trang…" : "Opening page…"}
          </p>
        )}
      </section>
    );
  return (
    <div className="collab-page">
      {notebookConfirmation}
      <div className="collab-page__heading">
        <button
          type="button"
          className="collab-back"
          onClick={() =>
            onBack(detail.project.my_access ? detail.project.id : undefined)
          }
        >
          <ArrowLeft size={17} />
          {detail.project.name}
        </button>
        <span className="collab-permission">
          <ShieldCheck size={14} />
          {canEdit
            ? language === "vi"
              ? "Có thể chỉnh sửa"
              : "Can edit"
            : canComment
              ? language === "vi"
                ? "Có thể bình luận"
                : "Can comment"
              : language === "vi"
                ? "Chỉ xem"
                : "View only"}
        </span>
      </div>
      <div className={`collab-page__grid ${references.pages.length ? "has-notebook-tree" : ""}`}>
        {references.pages.length > 0 && <NotebookTree apiBase={apiBase} language={language} projectId={detail.project.id} pageId={pageId} pages={references.pages} canEdit={detail.project.my_access >= 3} onOpen={onOpen} onChanged={refreshReferences} />}
        <article className="collab-card collab-page__main">
          <input
            className="collab-page__title"
            value={title}
            readOnly={!canEdit}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveTitle();
                event.currentTarget.blur();
              }
            }}
            aria-label={language === "vi" ? "Tên trang" : "Page title"}
          />
          <p className="collab-page__meta">
            {fieldName(detail.project.field, language)} ·{" "}
            {language === "vi" ? "Cập nhật" : "Updated"}{" "}
            {date(detail.page.updated_at, language)}
          </p>
          <Suspense
            fallback={
              <p role="status">
                <LoaderCircle className="spin" size={16} />{" "}
                {language === "vi" ? "Đang tải editor…" : "Loading editor…"}
              </p>
            }
          >
            <LiveEditor
              apiBase={apiBase}
              pageId={pageId}
              userId={user.id}
              username={user.public_name || user.name}
              language={language}
              canEdit={canEdit}
              onReady={setBody}
              onSync={setSynced}
              onBlocks={setBlocks}
              operation={operation}
            />
          </Suspense>
          <div className="collab-page__actions">
            <button type="button" disabled={!synced || !blocks.length} title={blocks.length ? "Export full block structure" : "Convert to blocks first; Markdown export remains available"} onClick={() => downloadText(`${title || "research-page"}.json`, JSON.stringify({ format: "nexora-notebook", version: 1, title, field: detail.project.field, exported_at: new Date().toISOString(), markdown: body, blocks, evidence: references.evidence.filter(item => body.includes(item.url)) }, null, 2))}><Download size={15} />JSON</button>
            <button
              type="button"
              disabled={!synced}
              onClick={() =>
                downloadText(
                  `${title || "research-page"}.md`,
                  `# ${title}\n\n${body}`,
                )
              }
            >
              <Download size={15} />
              Markdown
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(copyLink)}
            >
              <Copy size={15} />
              {language === "vi" ? "Sao chép link" : "Copy link"}
            </button>
            {canEdit && (
              <button type="button" onClick={importScratchpad}>
                <NotebookPen size={15} />
                {language === "vi" ? "Chép ghi chú Fields" : "Copy field note"}
              </button>
            )}
            {detail.page.can_manage && (
              <button type="button" onClick={archivePage} disabled={busy}>
                <Trash2 size={15} />
                {language === "vi" ? "Lưu trữ trang" : "Archive page"}
              </button>
            )}
          </div>
          {canEdit && blocks.length > 0 && <details className="collab-import"><summary>{language === "vi" ? "Nhập bản sao JSON" : "Import a JSON backup"}</summary><p>{language === "vi" ? "Thêm bản sao vào cuối trang, không ghi đè nội dung. Nội dung được nhập sẽ hiển thị cho người có quyền xem trang; file gốc vẫn được giữ." : "Append the backup without replacing this page. Imported content becomes visible to page members; your original file is kept."}</p><input type="file" aria-label={language === "vi" ? "Bản sao notebook JSON" : "Notebook JSON backup"} accept=".json,application/json" disabled={!synced || busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
            void act(async () => {
              if (file.size > 500000) throw new Error("Backup must be smaller than 500 KB");
              const backup = JSON.parse(await file.text()) as { format?: string; version?: number; blocks?: NotebookBlock[] };
              if (backup.format !== "nexora-notebook" || backup.version !== 1 || !Array.isArray(backup.blocks) || !backup.blocks.length) throw new Error("Choose a Nexora notebook JSON backup (version 1)");
              const allowed = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock", "table", "divider", "mathBlock"]);
              let count = 0;
              const copied = (items: NotebookBlock[], depth = 0): NotebookBlock[] => items.map(item => {
                if (++count > 3000 || depth > 50 || !allowed.has(item.type)) throw new Error("Backup contains unsupported or too many blocks");
                return { ...item, id: crypto.randomUUID(), children: copied(item.children || [], depth + 1) };
              });
              const imported = copied(backup.blocks);
              if (await confirmNotebook(language === "vi" ? "Thêm nội dung file này vào trang và chia sẻ với các thành viên của trang?" : "Append this file's content and make it visible to this page's members?")) setOperation({ id: Date.now(), mode: "append", content: "", blocks: imported });
            });
          }} /></details>}
          {synced && <NotebookBrief key={pageId} language={language} title={title} body={body} field={detail.project.field} references={references} onPrepare={onPrepareResearch} />}
          {canEdit && (
            <details className="collab-import">
              <summary>
                {language === "vi"
                  ? "Thêm khung nghiên cứu theo lĩnh vực"
                  : "Insert a field research template"}
              </summary>
              <div className="collab-inline-form">
                <select
                  aria-label={
                    language === "vi" ? "Khung nghiên cứu" : "Research template"
                  }
                  value={templateKind}
                  onChange={(event) =>
                    setTemplateKind(event.target.value as typeof templateKind)
                  }
                >
                  <option value="study">
                    {language === "vi"
                      ? "Dự án nghiên cứu chuyên ngành"
                      : "Field research project"}
                  </option>
                  <option value="paper">
                    {language === "vi"
                      ? "Ghi chú đọc paper"
                      : "Paper reading note"}
                  </option>
                </select>
                <button
                  type="button"
                  disabled={!synced}
                  onClick={() =>
                    setOperation({
                      id: Date.now(),
                      mode: "append",
                      content: researchTemplate(
                        detail.project.field,
                        language,
                        templateKind,
                      ),
                    })
                  }
                >
                  <Plus size={16} />
                  {language === "vi" ? "Chèn vào cuối trang" : "Append to page"}
                </button>
              </div>
            </details>
          )}
          {canEdit && reports.length > 0 && (
            <details className="collab-import">
              <summary>
                {language === "vi"
                  ? "Chép báo cáo cá nhân vào trang"
                  : "Copy a personal report into this page"}
              </summary>
              <div>
                {reports.slice(0, 12).map((report) => (
                  <button
                    type="button"
                    key={report.id}
                    onClick={() => importReport(report)}
                  >
                    <FileText size={15} />
                    {report.title}
                  </button>
                ))}
              </div>
            </details>
          )}
        </article>
        <aside className="collab-card collab-page__side">
          <div className="collab-side-tabs">
            {(
              [
                ["sources", BookOpen, language === "vi" ? "Nguồn" : "Sources"],
                [
                  "discussion",
                  MessageCircle,
                  language === "vi" ? "Thảo luận" : "Discuss",
                ],
                ["sharing", UserPlus, language === "vi" ? "Chia sẻ" : "Share"],
                [
                  "history",
                  History,
                  language === "vi" ? "Phiên bản" : "History",
                ],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                type="button"
                key={id}
                className={openPanel === id ? "is-active" : ""}
                onClick={() => setOpenPanel(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          {openPanel === "sources" && <NotebookSources language={language} references={{ ...references, pages: references.pages.filter(page => page.id !== pageId) }} body={body} canEdit={canEdit && synced} onOpen={onOpen} onInsert={content => setOperation({ id: Date.now(), mode: "append", content })} />}
          {openPanel === "discussion" && (
            <div className="collab-side-content">
              <h3>
                {language === "vi" ? "Trao đổi theo trang" : "Page discussion"}
              </h3>
              {detail.comments.length ? (
                detail.comments.map((item) => (
                  <div className="collab-comment" key={item.id}>
                    <PersonChip person={item.author} />
                    <p>{item.body}</p>
                    <small>{date(item.created_at, language)}</small>
                    {(item.author.id === user.id || detail.page.can_manage) && (
                      <button
                        type="button"
                        className="collab-icon-action"
                        disabled={busy}
                        aria-label={
                          language === "vi" ? "Xóa bình luận" : "Delete comment"
                        }
                        onClick={() =>
                          void act(async () => {
                            await api(apiBase, `/comments/${item.id}`, {
                              method: "DELETE",
                            });
                            await refresh();
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="collab-muted">
                  {language === "vi"
                    ? "Chưa có bình luận. Dùng nơi này để phản biện và đặt câu hỏi."
                    : "No comments yet. Use this space for review questions."}
                </p>
              )}
              {canComment && (
                <form onSubmit={addComment}>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={
                      language === "vi" ? "Viết bình luận…" : "Write a comment…"
                    }
                    maxLength={4000}
                  />
                  <button type="submit" disabled={!comment.trim() || busy}>
                    {language === "vi" ? "Gửi bình luận" : "Post comment"}
                  </button>
                </form>
              )}
            </div>
          )}
          {openPanel === "sharing" && (
            <div className="collab-side-content">
              <h3>
                {language === "vi"
                  ? "Ai có quyền truy cập?"
                  : "Who has access?"}
              </h3>
              <p className="collab-muted">
                {language === "vi"
                  ? "Link không tự cấp quyền. Thành viên dự án có thể đã có quyền từ dự án; lời mời riêng chỉ áp dụng cho trang này."
                  : "A link does not grant access. Project members may inherit access; individual invitations apply only to this page."}
              </p>
              {detail.shares.map((share) => (
                <div className="collab-share" key={share.id}>
                  <PersonChip person={share} />
                  {detail.page.can_manage ? (
                    <select
                      aria-label={`${share.display_name} permission`}
                      value={share.role}
                      disabled={busy}
                      onChange={(event) =>
                        void act(async () => {
                          await api(
                            apiBase,
                            `/pages/${pageId}/shares/${share.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                role: event.target.value,
                              }),
                            },
                          );
                          await refresh();
                        })
                      }
                    >
                      <option value="viewer">
                        {language === "vi" ? "Xem" : "View"}
                      </option>
                      <option value="commenter">
                        {language === "vi" ? "Bình luận" : "Comment"}
                      </option>
                      <option value="editor">
                        {language === "vi" ? "Chỉnh sửa" : "Edit"}
                      </option>
                    </select>
                  ) : (
                    <small>{share.role}</small>
                  )}
                  {detail.page.can_manage && share.id !== user.id && (
                    <button
                      type="button"
                      title="Revoke"
                      onClick={() =>
                        void act(async () => {
                          await api(
                            apiBase,
                            `/pages/${pageId}/shares/${share.id}`,
                            { method: "DELETE" },
                          );
                          await refresh();
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {detail.page.can_manage && (
                <form onSubmit={invite}>
                  <label>
                    {language === "vi"
                      ? "Mời bằng tên người dùng"
                      : "Invite by username"}
                    <input
                      value={inviteName}
                      onChange={(event) => setInviteName(event.target.value)}
                      placeholder="MinhKhoi2007"
                    />
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(event.target.value as typeof inviteRole)
                    }
                  >
                    <option value="viewer">
                      {language === "vi" ? "Xem" : "View"}
                    </option>
                    <option value="commenter">
                      {language === "vi" ? "Bình luận" : "Comment"}
                    </option>
                    <option value="editor">
                      {language === "vi" ? "Chỉnh sửa" : "Edit"}
                    </option>
                  </select>
                  <button type="submit" disabled={!inviteName.trim() || busy}>
                    {language === "vi" ? "Gửi lời mời" : "Send invite"}
                  </button>
                </form>
              )}
              <PendingInvitations
                apiBase={apiBase}
                language={language}
                invitations={detail.pending_invites}
                onChanged={refresh}
              />
            </div>
          )}
          {openPanel === "history" && (
            <div className="collab-side-content">
              <h3>
                {language === "vi" ? "Các mốc nội dung" : "Content snapshots"}
              </h3>
              <p className="collab-muted">
                {language === "vi"
                  ? "Bản lưu thủ công giúp quay lại một mốc quan trọng. Mọi nét gõ vẫn được đồng bộ realtime."
                  : "Manual snapshots preserve milestones; live edits sync continuously."}
              </p>
              {canEdit && (
                <div className="collab-version-create">
                  <input
                    value={versionLabel}
                    onChange={(event) => setVersionLabel(event.target.value)}
                    placeholder={
                      language === "vi"
                        ? "Tên mốc (không bắt buộc)"
                        : "Snapshot name (optional)"
                    }
                  />
                  <button
                    type="button"
                    disabled={busy || !synced}
                    onClick={saveVersion}
                  >
                    {language === "vi" ? "Lưu phiên bản" : "Save version"}
                  </button>
                </div>
              )}
              {detail.versions.map((version) => (
                <div className="collab-version" key={version.id}>
                  <strong>{version.label}</strong>
                  <small>
                    {date(version.created_at, language)} ·{" "}
                    {version.author.display_name}
                  </small>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => restoreVersion(version)}
                      disabled={busy || !synced}
                    >
                      {language === "vi" ? "Khôi phục" : "Restore"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {(message || error) && (
            <p
              className={
                error ? "collab-inline-error" : "collab-inline-success"
              }
              role="status"
            >
              {error || message}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function GroupManagement({
  apiBase,
  language,
  group,
  userId,
  onChanged,
}: {
  apiBase: string;
  language: Language;
  group: Group;
  userId: string;
  onChanged: (removed?: boolean) => Promise<void>;
}) {
  const isVi = language === "vi";
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [transferName, setTransferName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(group.name);
    setDescription(group.description);
    setTransferName("");
  }, [group.id, group.name, group.description]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const role = group.my_role;
  return (
    <div className="collab-management">
      {role !== "member" && (
        <form
          className="collab-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api(apiBase, `/groups/${group.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: name.trim(),
                  description: description.trim(),
                }),
              });
              await onChanged();
            });
          }}
        >
          <h4>{isVi ? "Thông tin nhóm" : "Group details"}</h4>
          <label>
            {isVi ? "Tên nhóm" : "Group name"}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
          </label>
          <label>
            {isVi ? "Mô tả" : "Description"}
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
            />
          </label>
          <button type="submit" disabled={busy || name.trim().length < 2}>
            {isVi ? "Lưu thay đổi" : "Save changes"}
          </button>
        </form>
      )}
      <PendingInvitations
        apiBase={apiBase}
        language={language}
        invitations={group.pending_invites}
        onChanged={() => onChanged()}
      />
      <h4>{isVi ? "Quyền thành viên" : "Member permissions"}</h4>
      {group.members.map((member) => (
        <div className="collab-member" key={member.id}>
          <PersonChip person={member} />
          {role === "owner" && member.id !== userId ? (
            <select
              aria-label={`${member.display_name} role`}
              value={member.role}
              disabled={busy}
              onChange={(event) =>
                void run(async () => {
                  await api(
                    apiBase,
                    `/groups/${group.id}/members/${member.id}`,
                    {
                      method: "PATCH",
                      body: JSON.stringify({ role: event.target.value }),
                    },
                  );
                  await onChanged();
                })
              }
            >
              <option value="admin">{isVi ? "Quản trị" : "Admin"}</option>
              <option value="member">{isVi ? "Thành viên" : "Member"}</option>
            </select>
          ) : (
            <span>{member.role}</span>
          )}
          {member.id !== userId &&
            (role === "owner" ||
              (role === "admin" && member.role === "member")) && (
              <button
                type="button"
                disabled={busy}
                title={isVi ? "Xóa khỏi nhóm" : "Remove from group"}
                onClick={() => {
                  if (
                    window.confirm(
                      isVi
                        ? `Xóa ${member.display_name} khỏi nhóm và thu hồi quyền của họ trong các dự án nhóm?`
                        : `Remove ${member.display_name} and revoke their group project access?`,
                    )
                  )
                    void run(async () => {
                      await api(
                        apiBase,
                        `/groups/${group.id}/members/${member.id}`,
                        { method: "DELETE" },
                      );
                      await onChanged();
                    });
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
        </div>
      ))}
      {role === "owner" && (
        <div className="collab-management__transfer">
          <h4>{isVi ? "Chuyển quyền sở hữu" : "Transfer ownership"}</h4>
          <p className="collab-muted">
            {isVi
              ? "Chỉ chuyển cho người đã ở trong nhóm. Bạn sẽ trở thành quản trị viên."
              : "Choose an existing member. You will become an admin."}
          </p>
          <div className="collab-inline-form">
            <select
              value={transferName}
              onChange={(event) => setTransferName(event.target.value)}
            >
              <option value="">
                {isVi ? "Chọn thành viên" : "Choose member"}
              </option>
              {group.members
                .filter((member) => member.id !== userId && member.public_name)
                .map((member) => (
                  <option key={member.id} value={member.public_name || ""}>
                    {member.display_name} · {member.public_name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!transferName || busy}
              onClick={() => {
                if (
                  window.confirm(
                    isVi
                      ? "Chuyển quyền sở hữu nhóm cho thành viên này?"
                      : "Transfer group ownership to this member?",
                  )
                )
                  void run(async () => {
                    await api(apiBase, `/groups/${group.id}/transfer`, {
                      method: "POST",
                      body: JSON.stringify({ username: transferName }),
                    });
                    await onChanged();
                  });
              }}
            >
              {isVi ? "Chuyển quyền" : "Transfer"}
            </button>
          </div>
        </div>
      )}
      {role === "owner" ? (
        <button
          type="button"
          className="collab-secondary-button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                isVi
                  ? "Lưu trữ nhóm? Mọi dự án và trang của nhóm sẽ tạm thời không truy cập được."
                  : "Archive group? All group projects and pages will become unavailable until restored.",
              )
            )
              void run(async () => {
                await api(apiBase, `/groups/${group.id}/archive`, {
                  method: "POST",
                });
                await onChanged(true);
              });
          }}
        >
          {isVi ? "Lưu trữ nhóm" : "Archive group"}
        </button>
      ) : (
        <button
          type="button"
          className="collab-secondary-button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                isVi
                  ? "Rời nhóm? Quyền dự án và trang trong nhóm sẽ bị thu hồi."
                  : "Leave group? Your group project and page access will be revoked.",
              )
            )
              void run(async () => {
                await api(apiBase, `/groups/${group.id}/members/${userId}`, {
                  method: "DELETE",
                });
                await onChanged(true);
              });
          }}
        >
          {isVi ? "Rời nhóm" : "Leave group"}
        </button>
      )}
      {error && (
        <p className="collab-inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SavedPaperPicker({
  apiBase,
  language,
  field,
  onPick,
}: {
  apiBase: string;
  language: Language;
  field: FieldId;
  onPick: (paper: { title: string; url: string; doi: string }) => Promise<void>;
}) {
  const [papers, setPapers] = useState<
    { id: string; title: string; url: string; doi: string; journal?: string }[]
  >([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (loaded) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${apiBase}/api/papers/library?field=${encodeURIComponent(field)}`,
        { credentials: "include" },
      );
      if (!response.ok)
        throw new Error(
          language === "vi"
            ? "Không tải được paper cá nhân."
            : "Could not load your papers.",
        );
      const result = (await response.json()) as { papers: typeof papers };
      setPapers(result.papers || []);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="collab-import"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>
        {language === "vi"
          ? "Chọn từ thư viện paper cá nhân"
          : "Choose from my saved papers"}
      </summary>
      <p className="collab-muted">
        {language === "vi"
          ? "Chỉ tiêu đề, URL và DOI được đưa vào dự án. Ghi chú đọc cá nhân không bị chia sẻ."
          : "Only title, URL and DOI are copied. Your private reading notes stay private."}
      </p>
      {busy && (
        <p className="collab-muted">
          {language === "vi" ? "Đang tải…" : "Loading…"}
        </p>
      )}
      {error && (
        <p className="collab-inline-error" role="alert">
          {error}
        </p>
      )}
      {loaded && !papers.length && (
        <p className="collab-muted">
          {language === "vi"
            ? "Chưa lưu paper nào trong lĩnh vực này."
            : "No saved papers for this field yet."}
        </p>
      )}
      <div className="collab-paper-picker">
        {papers.map((paper) => (
          <button
            type="button"
            key={paper.id}
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  language === "vi"
                    ? `Chia sẻ metadata của “${paper.title}” với dự án?`
                    : `Share metadata for “${paper.title}” with this project?`,
                )
              )
                return;
              setBusy(true);
              void onPick(paper)
                .catch((reason: Error) => setError(reason.message))
                .finally(() => setBusy(false));
            }}
          >
            <BookOpen size={16} />
            <span>
              <strong>{paper.title}</strong>
              <small>{paper.journal || paper.doi || paper.url}</small>
            </span>
            <Plus size={15} />
          </button>
        ))}
      </div>
    </details>
  );
}

function ProjectSettings({
  apiBase,
  language,
  project,
  onChanged,
}: {
  apiBase: string;
  language: Language;
  project: Project;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
  }, [project.id, project.name, project.description]);
  return (
    <section className="collab-card">
      <h3>{language === "vi" ? "Thông tin dự án" : "Project details"}</h3>
      <form
        className="collab-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void api(apiBase, `/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: name.trim(),
              description: description.trim(),
            }),
          })
            .then(onChanged)
            .catch((reason: Error) => setError(reason.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {language === "vi" ? "Tên dự án" : "Project name"}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          {language === "vi" ? "Mục tiêu và mô tả" : "Goal and description"}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </label>
        <button type="submit" disabled={busy || name.trim().length < 2}>
          {language === "vi" ? "Lưu thay đổi" : "Save changes"}
        </button>
        {error && (
          <p className="collab-inline-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function ProjectActivity({
  apiBase,
  language,
  projectId,
}: {
  apiBase: string;
  language: Language;
  projectId: string;
}) {
  const [events, setEvents] = useState<
    { id: number; actor: Person; action: string; created_at: string }[]
  >([]);
  const [error, setError] = useState("");
  const labels: Record<string, [string, string]> = {
    "project.created": ["Tạo dự án", "Created project"],
    "project.updated": ["Cập nhật dự án", "Updated project"],
    "page.created": ["Tạo trang", "Created page"],
    "page.updated": ["Cập nhật trang", "Updated page"],
    "page.archived": ["Lưu trữ trang", "Archived page"],
    "page.restored": ["Khôi phục trang", "Restored page"],
    "comment.created": ["Thêm bình luận", "Added comment"],
    "version.created": ["Lưu phiên bản", "Saved snapshot"],
    "task.created": ["Tạo nhiệm vụ", "Created task"],
    "task.updated": ["Cập nhật nhiệm vụ", "Updated task"],
    "evidence.added": ["Thêm nguồn nghiên cứu", "Added evidence"],
  };
  useEffect(() => {
    let active = true;
    const load = () =>
      void api<{ events: typeof events }>(
        apiBase,
        `/projects/${projectId}/activity`,
      )
        .then((result) => {
          if (active) {
            setEvents(result.events);
            setError("");
          }
        })
        .catch((reason: Error) => {
          if (active) setError(reason.message);
        });
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [apiBase, projectId]);
  return (
    <section className="collab-card">
      <h3>{language === "vi" ? "Hoạt động dự án" : "Project activity"}</h3>
      {events.map((item) => (
        <div className="collab-activity" key={item.id}>
          <PersonChip person={item.actor} />
          <span>
            {labels[item.action]?.[language === "vi" ? 0 : 1] || item.action}
          </span>
          <small>{date(item.created_at, language)}</small>
        </div>
      ))}
      {error && (
        <p className="collab-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PageOrganizer({
  apiBase,
  language,
  pages,
  onChanged,
}: {
  apiBase: string;
  language: Language;
  pages: Page[];
  onChanged: () => Promise<void>;
}) {
  const [pageId, setPageId] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!pages.length) return null;
  return (
    <details className="collab-archived">
      <summary>
        {language === "vi"
          ? "Sắp xếp trang vào mục"
          : "Organize page hierarchy"}
      </summary>
      <form
        className="collab-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void api(apiBase, `/pages/${pageId}`, {
            method: "PATCH",
            body: JSON.stringify({ parent_id: parentId || null }),
          })
            .then(onChanged)
            .catch((reason: Error) => setError(reason.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {language === "vi" ? "Trang cần di chuyển" : "Page to move"}
          <select
            value={pageId}
            onChange={(event) => {
              setPageId(event.target.value);
              setParentId(
                pages.find((page) => page.id === event.target.value)
                  ?.parent_id || "",
              );
            }}
          >
            <option value="">
              {language === "vi" ? "Chọn trang" : "Choose page"}
            </option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {language === "vi"
            ? "Chuyển vào trang cha"
            : "Move under parent page"}
          <select
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">
              {language === "vi" ? "Mục gốc" : "Top level"}
            </option>
            {pages
              .filter((page) => page.id !== pageId)
              .map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !pageId}>
          {language === "vi" ? "Di chuyển" : "Move page"}
        </button>
        {error && (
          <p className="collab-inline-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}

export function CollaborationHub({
  apiBase,
  language,
  user,
  reports,
  initialField,
  onEditProfile,
  onPrepareResearch,
}: {
  apiBase: string;
  language: Language;
  user: AuthUser;
  reports: StoredReportSummary[];
  initialField?: FieldId | null;
  onEditProfile: () => void;
  onPrepareResearch: (payload: DomainResearchPayload) => void;
}) {
  const [tab, setTab] = useState<Tab>("projects");
  const [groups, setGroups] = useState<Group[]>([]);
  const [archivedGroups, setArchivedGroups] = useState<ArchivedGroup[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedPages, setSharedPages] = useState<SharedPage[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () =>
      window.location.hash.match(/^#\/collab\/project\/([a-f0-9]+)/)?.[1] ||
      null,
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    () =>
      window.location.hash.match(/^#\/collab\/page\/([a-f0-9]+)/)?.[1] || null,
  );
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(
    null,
  );
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupInviteName, setGroupInviteName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectField, setProjectField] = useState<FieldId>(
    initialField || "artificial-intelligence",
  );
  const [fieldFilter, setFieldFilter] = useState<FieldId | null>(
    initialField || null,
  );
  const [projectCategory, setProjectCategory] = useState("");
  const [projectGroup, setProjectGroup] = useState("personal");
  const [projectVisibility, setProjectVisibility] = useState<
    "group" | "restricted"
  >("group");
  const [projectInviteName, setProjectInviteName] = useState("");
  const [projectInviteRole, setProjectInviteRole] = useState<
    "viewer" | "commenter" | "editor"
  >("editor");
  const [pageTitle, setPageTitle] = useState("");
  const [parentPageId, setParentPageId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceDoi, setEvidenceDoi] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [projectPane, setProjectPane] = useState<
    "pages" | "tasks" | "evidence" | "members" | "activity" | "settings"
  >("pages");
  const isVi = language === "vi";

  const refresh = useCallback(async () => {
    const [
      groupResult,
      archivedResult,
      projectResult,
      connectionResult,
      inviteResult,
      sharedResult,
    ] = await Promise.all([
      api<{ groups: Group[] }>(apiBase, "/groups"),
      api<{ groups: ArchivedGroup[] }>(apiBase, "/groups/archived"),
      api<{ projects: Project[] }>(apiBase, "/projects"),
      api<{ connections: Connection[] }>(apiBase, "/connections"),
      api<{ invites: Invitation[] }>(apiBase, "/invites"),
      api<{ pages: SharedPage[] }>(apiBase, "/shared-pages"),
    ]);
    setGroups(groupResult.groups);
    setArchivedGroups(archivedResult.groups);
    setProjects(projectResult.projects);
    setConnections(connectionResult.connections);
    setInvites(inviteResult.invites);
    setSharedPages(sharedResult.pages);
  }, [apiBase]);
  const refreshProject = useCallback(
    async (id: string) => {
      const result = await api<ProjectDetail>(apiBase, `/projects/${id}`);
      setProjectDetail(result);
    },
    [apiBase],
  );

  useEffect(() => {
    void refresh()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (selectedProjectId)
      void refreshProject(selectedProjectId).catch((reason: Error) =>
        setError(reason.message),
      );
  }, [selectedProjectId, refreshProject]);
  useEffect(() => {
    setFieldFilter(initialField || null);
    if (initialField) setProjectField(initialField);
  }, [initialField]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch((reason: Error) => setError(reason.message));
    }, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (search.trim().length < 2) {
      setPeople([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<{ people: Person[] }>(
        apiBase,
        `/people?query=${encodeURIComponent(search.trim())}`,
      )
        .then((result) => setPeople(result.people))
        .catch((reason: Error) => setError(reason.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [apiBase, search]);
  useEffect(() => {
    const sync = () => {
      const pageId =
        window.location.hash.match(/^#\/collab\/page\/([a-f0-9]+)/)?.[1] ||
        null;
      const projectId =
        window.location.hash.match(/^#\/collab\/project\/([a-f0-9]+)/)?.[1] ||
        null;
      setSelectedPageId(pageId);
      setSelectedProjectId(projectId);
      if (!projectId) setProjectDetail(null);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const openProject = (id: string) => {
    setTab("projects");
    setSelectedProjectId(id);
    setSelectedPageId(null);
    setProjectPane("pages");
    window.history.pushState({}, "", `#/collab/project/${id}`);
    window.scrollTo(0, 0);
  };
  const openPage = (id: string) => {
    setSelectedPageId(id);
    window.history.pushState({}, "", `#/collab/page/${id}`);
    window.scrollTo(0, 0);
  };
  const backToProject = (projectId?: string) => {
    if (projectId) {
      openProject(projectId);
      return;
    }
    setSelectedPageId(null);
    if (selectedProjectId) void refreshProject(selectedProjectId);
    window.history.pushState(
      {},
      "",
      selectedProjectId ? `#/collab/project/${selectedProjectId}` : "#/collab",
    );
  };
  const backToHub = () => {
    setSelectedProjectId(null);
    setProjectDetail(null);
    setSelectedGroupId(null);
    window.history.pushState({}, "", "#/collab");
  };

  const createGroup = (event: FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    void act(async () => {
      const result = await api<{ group: Group }>(apiBase, "/groups", {
        method: "POST",
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim(),
        }),
      });
      setGroupName("");
      setGroupDescription("");
      await refresh();
      setSelectedGroupId(result.group.id);
      setTab("groups");
    });
  };
  const inviteGroup = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedGroupId || !groupInviteName.trim()) return;
    void act(async () => {
      await api(apiBase, `/groups/${selectedGroupId}/invites`, {
        method: "POST",
        body: JSON.stringify({
          username: groupInviteName.trim(),
          role: "member",
        }),
      });
      setGroupInviteName("");
      await refresh();
      setSuccess(isVi ? "Đã gửi lời mời vào nhóm." : "Group invitation sent.");
    });
  };
  const createProject = (event: FormEvent) => {
    event.preventDefault();
    if (!projectName.trim()) return;
    void act(async () => {
      const query =
        projectGroup === "personal"
          ? ""
          : `?group_id=${encodeURIComponent(projectGroup)}`;
      const result = await api<{ project: Project }>(
        apiBase,
        `/projects${query}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: projectName.trim(),
            description: projectDescription.trim(),
            field: projectField,
            category: projectCategory.trim(),
            visibility: projectVisibility,
          }),
        },
      );
      setProjectName("");
      setProjectDescription("");
      setProjectCategory("");
      await refresh();
      openProject(result.project.id);
    });
  };
  const createPage = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !pageTitle.trim()) return;
    void act(async () => {
      const result = await api<{ page: Page }>(
        apiBase,
        `/projects/${selectedProjectId}/pages`,
        {
          method: "POST",
          body: JSON.stringify({
            title: pageTitle.trim(),
            parent_id: parentPageId || null,
          }),
        },
      );
      setPageTitle("");
      setParentPageId("");
      await refreshProject(selectedProjectId);
      openPage(result.page.id);
    });
  };
  const createTask = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !taskTitle.trim()) return;
    void act(async () => {
      await api(apiBase, `/projects/${selectedProjectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: taskTitle.trim(),
          assignee_username: taskAssignee || null,
        }),
      });
      setTaskTitle("");
      setTaskAssignee("");
      await refreshProject(selectedProjectId);
    });
  };
  const addEvidence = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !evidenceTitle.trim() || !evidenceUrl.trim())
      return;
    void act(async () => {
      await api(apiBase, `/projects/${selectedProjectId}/evidence`, {
        method: "POST",
        body: JSON.stringify({
          title: evidenceTitle.trim(),
          url: evidenceUrl.trim(),
          doi: evidenceDoi.trim(),
          note: evidenceNote.trim(),
        }),
      });
      setEvidenceTitle("");
      setEvidenceUrl("");
      setEvidenceDoi("");
      setEvidenceNote("");
      await refreshProject(selectedProjectId);
    });
  };
  const addSavedPaper = async (paper: {
    title: string;
    url: string;
    doi: string;
  }) => {
    if (!selectedProjectId) return;
    await api(apiBase, `/projects/${selectedProjectId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        title: paper.title,
        url: paper.url,
        doi: paper.doi,
      }),
    });
    await refreshProject(selectedProjectId);
  };
  const inviteProject = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !projectInviteName.trim()) return;
    void act(async () => {
      await api(apiBase, `/projects/${selectedProjectId}/invites`, {
        method: "POST",
        body: JSON.stringify({
          username: projectInviteName.trim(),
          role: projectInviteRole,
        }),
      });
      setProjectInviteName("");
      await refreshProject(selectedProjectId);
      setSuccess(isVi ? "Đã gửi lời mời dự án." : "Project invitation sent.");
    });
  };
  const respondInvite = (item: Invitation, action: "accept" | "decline") => {
    void act(async () => {
      await api(apiBase, `/invites/${item.id}?action=${action}`, {
        method: "PATCH",
      });
      await refresh();
      if (action === "accept") {
        if (item.kind === "page") openPage(item.target_id);
        else if (item.kind === "project") openProject(item.target_id);
        else {
          setTab("groups");
          setSelectedGroupId(item.target_id);
        }
      }
    });
  };
  const respondConnection = (
    item: Connection,
    action: "accept" | "decline" | "block",
  ) => {
    void act(async () => {
      await api(apiBase, `/connections/${item.id}?action=${action}`, {
        method: "PATCH",
      });
      await refresh();
    });
  };
  const requestConnection = (person: Person) => {
    if (!person.public_name) return;
    void act(async () => {
      await api(apiBase, "/connections", {
        method: "POST",
        body: JSON.stringify({ username: person.public_name }),
      });
      await refresh();
      setSuccess(isVi ? "Đã gửi lời mời kết nối." : "Connection request sent.");
    });
  };
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const filteredProjects = fieldFilter
    ? projects.filter((item) => item.field === fieldFilter)
    : projects;
  const activeProjects = filteredProjects.filter(
    (item) => item.status !== "archived",
  );
  const archivedProjects = filteredProjects.filter(
    (item) => item.status === "archived",
  );
  const pageDepth = (page: Page, list: Page[]) => {
    let depth = 0;
    let current = page;
    const seen = new Set([page.id]);
    while (current.parent_id && depth < 4) {
      const parent = list.find((item) => item.id === current.parent_id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      depth++;
      current = parent;
    }
    return depth;
  };
  const sortedPages = useMemo(() => {
    const list = projectDetail?.pages || [];
    const output: Page[] = [];
    const walk = (parent: string | null) => {
      list
        .filter((item) => item.parent_id === parent)
        .forEach((item) => {
          output.push(item);
          walk(item.id);
        });
    };
    walk(null);
    list
      .filter((item) => !output.includes(item))
      .forEach((item) => output.push(item));
    return output;
  }, [projectDetail?.pages]);

  if (selectedPageId)
    return (
      <div className="collab-hub">
        <PageView
          key={selectedPageId}
          apiBase={apiBase}
          pageId={selectedPageId}
          language={language}
          user={user}
          reports={reports}
          onBack={backToProject}
          onOpen={openPage}
          onPrepareResearch={onPrepareResearch}
        />
      </div>
    );

  return (
    <div className="collab-hub">
      <section className="collab-hero">
        <div>
          <span className="eyebrow">
            <Sparkles size={16} />
            {isVi ? "RESEARCH TOGETHER" : "RESEARCH TOGETHER"}
          </span>
          <h1>
            {isVi
              ? "Từ ý tưởng cá nhân đến dự án chung."
              : "From personal ideas to shared discoveries."}
          </h1>
          <p>
            {isVi
              ? "Tổ chức ghi chú theo lĩnh vực, lập nhóm, chia sẻ bằng chứng và cùng viết trực tiếp trên một trang."
              : "Organize field notes, form research groups, share evidence, and write together on the same live page."}
          </p>
        </div>
        <div className="collab-hero__graphic" aria-hidden="true">
          <span>
            <NotebookPen size={24} />
          </span>
          <i />
          <span>
            <Users size={24} />
          </span>
          <i />
          <span>
            <BookOpen size={24} />
          </span>
        </div>
      </section>
      {!user.public_name && (
        <section className="collab-identity collab-card">
          <div>
            <span className="collab-kicker">
              01 · {isVi ? "DANH TÍNH" : "IDENTITY"}
            </span>
            <h2>
              {isVi
                ? "Hoàn thiện tên trong hồ sơ"
                : "Complete your profile name"}
            </h2>
            <p>
              {isVi
                ? "Vào Chỉnh sửa hồ sơ để lưu tên người dùng duy nhất trước khi mở Notebook và Dự án."
                : "Save a unique name in Edit profile before opening Notebook and Projects."}
            </p>
          </div>
          <button type="button" className="collab-secondary-button" onClick={onEditProfile}>
            {isVi ? "Chỉnh sửa hồ sơ" : "Edit profile"}
          </button>
        </section>
      )}
      {user.public_name && (
        <div
          className="collab-tabs"
          role="tablist"
          aria-label={isVi ? "Không gian cộng tác" : "Collaboration sections"}
        >
          {(
            [
              [
                "projects",
                FolderPlus,
                isVi ? "Dự án" : "Projects",
                projects.length,
              ],
              ["groups", Users, isVi ? "Nhóm" : "Groups", groups.length],
              [
                "people",
                UserPlus,
                isVi ? "Kết nối" : "Connections",
                connections.filter((item) => item.status === "accepted").length,
              ],
              [
                "inbox",
                MessageCircle,
                isVi ? "Lời mời" : "Invitations",
                invites.length +
                  connections.filter(
                    (item) =>
                      item.status === "pending" &&
                      item.direction === "incoming",
                  ).length,
              ],
            ] as const
          ).map(([id, Icon, label, count]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-active" : ""}
              key={id}
              onClick={() => {
                setTab(id);
                setSelectedProjectId(null);
                setSelectedGroupId(null);
                window.history.pushState({}, "", "#/collab");
              }}
            >
              <Icon size={18} />
              {label}
              <small>{count}</small>
            </button>
          ))}
        </div>
      )}
      {(error || success) && (
        <p
          className={error ? "collab-inline-error" : "collab-inline-success"}
          role="status"
        >
          {error || success}
        </p>
      )}
      {loading && (
        <p className="collab-loading">
          <LoaderCircle className="spin" size={20} />
          {isVi ? "Đang tải không gian nghiên cứu…" : "Loading research space…"}
        </p>
      )}
      {user.public_name &&
        tab === "projects" &&
        fieldFilter &&
        !selectedProjectId && (
          <div className="collab-filter-note">
            <span>
              {isVi ? "Đang lọc theo lĩnh vực:" : "Filtered by field:"}{" "}
              <strong>{fieldName(fieldFilter, language)}</strong>
            </span>
            <button type="button" onClick={() => setFieldFilter(null)}>
              {isVi ? "Xem tất cả lĩnh vực" : "Show all fields"}
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      {!loading &&
        user.public_name &&
        tab === "projects" &&
        (selectedProjectId && projectDetail ? (
          <div className="collab-project">
            <button className="collab-back" type="button" onClick={backToHub}>
              <ArrowLeft size={17} />
              {isVi ? "Tất cả dự án" : "All projects"}
            </button>
            <header className="collab-project__head">
              <span className="collab-kicker">
                {fieldName(projectDetail.project.field, language)}{" "}
                {projectDetail.project.category &&
                  `· ${projectDetail.project.category}`}
              </span>
              <h2>{projectDetail.project.name}</h2>
              <p>
                {projectDetail.project.description ||
                  (isVi
                    ? "Thêm mục tiêu và câu hỏi nghiên cứu để mọi người cùng định hướng."
                    : "Add a research goal to align your team.")}
              </p>
              <div>
                <span>
                  <ShieldCheck size={15} />
                  {projectDetail.project.visibility === "restricted"
                    ? isVi
                      ? "Chỉ người được mời"
                      : "Invited only"
                    : isVi
                      ? "Thành viên nhóm"
                      : "Group members"}
                </span>
                <span>
                  <Clock3 size={15} />
                  {date(projectDetail.project.updated_at, language)}
                </span>
                <select
                  aria-label={isVi ? "Trạng thái dự án" : "Project status"}
                  value={projectDetail.project.status}
                  disabled={projectDetail.project.my_access < 4 || busy}
                  onChange={(event) =>
                    void act(async () => {
                      await api(apiBase, `/projects/${selectedProjectId}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: event.target.value }),
                      });
                      await refreshProject(selectedProjectId);
                      await refresh();
                    })
                  }
                >
                  <option value="planning">
                    {isVi ? "Lập kế hoạch" : "Planning"}
                  </option>
                  <option value="active">{isVi ? "Đang làm" : "Active"}</option>
                  <option value="review">
                    {isVi ? "Phản biện" : "Review"}
                  </option>
                  <option value="complete">
                    {isVi ? "Hoàn thành" : "Complete"}
                  </option>
                  <option value="archived">
                    {isVi ? "Lưu trữ" : "Archived"}
                  </option>
                </select>
              </div>
            </header>
            <div className="collab-project__tabs">
              {(
                [
                  ["pages", FileText, isVi ? "Trang nghiên cứu" : "Pages"],
                  ["tasks", CheckCircle2, isVi ? "Việc cần làm" : "Tasks"],
                  ["evidence", Link2, isVi ? "Nguồn & paper" : "Evidence"],
                  ["members", Users, isVi ? "Thành viên" : "Members"],
                  ["activity", History, isVi ? "Hoạt động" : "Activity"],
                  ...(projectDetail.project.my_access >= 4
                    ? [
                        [
                          "settings",
                          NotebookPen,
                          isVi ? "Thông tin" : "Details",
                        ] as const,
                      ]
                    : []),
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  className={projectPane === id ? "is-active" : ""}
                  onClick={() => setProjectPane(id)}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            {projectPane === "activity" && (
              <ProjectActivity
                apiBase={apiBase}
                language={language}
                projectId={selectedProjectId}
              />
            )}
            {projectPane === "settings" &&
              projectDetail.project.my_access >= 4 && (
                <ProjectSettings
                  apiBase={apiBase}
                  language={language}
                  project={projectDetail.project}
                  onChanged={async () => {
                    await refreshProject(selectedProjectId);
                    await refresh();
                  }}
                />
              )}
            {projectPane === "pages" && (
              <div className="collab-project__two">
                <section className="collab-card">
                  <h3>{isVi ? "Cây trang của dự án" : "Project pages"}</h3>
                  <NotebookSearch apiBase={apiBase} language={language} projectId={selectedProjectId} onOpen={openPage} />
                  {projectDetail.project.my_access >= 3 && (
                    <PageOrganizer
                      apiBase={apiBase}
                      language={language}
                      pages={projectDetail.pages}
                      onChanged={() => refreshProject(selectedProjectId)}
                    />
                  )}
                  <p className="collab-muted">
                    {isVi
                      ? "Trang cha, trang con và nội dung cùng gõ realtime. Link chỉ mở cho người có quyền."
                      : "Nested pages with live editing. Links work only for authorized readers."}
                  </p>
                  <div className="collab-page-list">
                    {sortedPages.length ? (
                      sortedPages.map((page) => (
                        <button
                          key={page.id}
                          type="button"
                          style={{
                            paddingLeft: `${14 + pageDepth(page, sortedPages) * 21}px`,
                          }}
                          onClick={() => openPage(page.id)}
                        >
                          <FileText size={17} />
                          <span>{page.title}</span>
                          <ArrowRight size={15} />
                        </button>
                      ))
                    ) : (
                      <div className="collab-empty">
                        <BookOpen size={26} />
                        <strong>
                          {isVi ? "Chưa có trang nào" : "No pages yet"}
                        </strong>
                        <p>
                          {isVi
                            ? "Tạo trang đầu tiên để định hình dự án."
                            : "Create the first page to shape this project."}
                        </p>
                      </div>
                    )}
                  </div>
                  {projectDetail.project.my_access >= 4 &&
                    projectDetail.archived_pages.length > 0 && (
                      <details className="collab-archived">
                        <summary>
                          {isVi ? "Trang đã lưu trữ" : "Archived pages"} ·{" "}
                          {projectDetail.archived_pages.length}
                        </summary>
                        {projectDetail.archived_pages.map((page) => (
                          <div className="collab-archived__item" key={page.id}>
                            <span>{page.title}</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await api(
                                    apiBase,
                                    `/pages/${page.id}/restore`,
                                    { method: "POST" },
                                  );
                                  await refreshProject(selectedProjectId);
                                })
                              }
                            >
                              {isVi ? "Khôi phục" : "Restore"}
                            </button>
                          </div>
                        ))}
                      </details>
                    )}
                </section>
                {projectDetail.project.my_access >= 3 && (
                  <section className="collab-card">
                    <h3>
                      <FilePlus2 size={20} />
                      {isVi ? "Tạo trang mới" : "Create page"}
                    </h3>
                    <form className="collab-form" onSubmit={createPage}>
                      <label>
                        {isVi ? "Tên trang" : "Page title"}
                        <input
                          value={pageTitle}
                          onChange={(event) => setPageTitle(event.target.value)}
                          placeholder={
                            isVi
                              ? "Ví dụ: Câu hỏi nghiên cứu"
                              : "E.g. Research questions"
                          }
                          maxLength={120}
                        />
                      </label>
                      <label>
                        {isVi
                          ? "Trang cha (tùy chọn)"
                          : "Parent page (optional)"}
                        <select
                          value={parentPageId}
                          onChange={(event) =>
                            setParentPageId(event.target.value)
                          }
                        >
                          <option value="">
                            {isVi ? "Trang gốc" : "Top-level page"}
                          </option>
                          {projectDetail.pages.map((page) => (
                            <option key={page.id} value={page.id}>
                              {page.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={busy || !pageTitle.trim()}
                      >
                        <Plus size={16} />
                        {isVi ? "Tạo và mở trang" : "Create and open"}
                      </button>
                    </form>
                    <div className="collab-template-tips">
                      <strong>
                        {isVi ? "Gợi ý cấu trúc" : "Suggested structure"}
                      </strong>
                      <span>
                        {isVi
                          ? "Câu hỏi → Phương pháp → Bằng chứng → Phản biện → Kết luận"
                          : "Question → Method → Evidence → Review → Conclusion"}
                      </span>
                    </div>
                  </section>
                )}
              </div>
            )}
            {projectPane === "tasks" && (
              <section className="collab-card">
                <h3>{isVi ? "Việc cần làm" : "Research tasks"}</h3>
                {projectDetail.project.my_access >= 3 && (
                  <form className="collab-inline-form" onSubmit={createTask}>
                    <input
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.target.value)}
                      placeholder={
                        isVi
                          ? "Ví dụ: Đọc 5 paper về RAG evaluation"
                          : "E.g. Read five papers on RAG evaluation"
                      }
                      maxLength={200}
                    />
                    <select
                      value={taskAssignee}
                      onChange={(event) => setTaskAssignee(event.target.value)}
                      aria-label={isVi ? "Giao cho" : "Assign to"}
                    >
                      <option value="">
                        {isVi ? "Chưa giao" : "Unassigned"}
                      </option>
                      {projectDetail.assignable
                        .filter((person) => person.public_name)
                        .map((person) => (
                          <option
                            key={person.id}
                            value={person.public_name || ""}
                          >
                            {person.display_name}
                          </option>
                        ))}
                    </select>
                    <button type="submit" disabled={busy || !taskTitle.trim()}>
                      <Plus size={16} />
                      {isVi ? "Thêm việc" : "Add task"}
                    </button>
                  </form>
                )}
                {projectDetail.tasks.length ? (
                  projectDetail.tasks.map((task) => (
                    <div className="collab-task" key={task.id}>
                      <select
                        value={task.status}
                        disabled={projectDetail.project.my_access < 3 || busy}
                        onChange={(event) =>
                          void act(async () => {
                            await api(
                              apiBase,
                              `/tasks/${task.id}?status=${event.target.value}`,
                              { method: "PATCH" },
                            );
                            await refreshProject(selectedProjectId);
                          })
                        }
                      >
                        <option value="todo">
                          {isVi ? "Cần làm" : "To do"}
                        </option>
                        <option value="doing">
                          {isVi ? "Đang làm" : "In progress"}
                        </option>
                        <option value="done">{isVi ? "Xong" : "Done"}</option>
                      </select>
                      <span className={task.status === "done" ? "is-done" : ""}>
                        {task.title}
                      </span>
                      {task.assignee && <PersonChip person={task.assignee} />}
                      {projectDetail.project.my_access >= 3 && (
                        <button
                          type="button"
                          className="collab-icon-action"
                          disabled={busy}
                          aria-label={isVi ? "Xóa nhiệm vụ" : "Delete task"}
                          onClick={() =>
                            void act(async () => {
                              await api(apiBase, `/tasks/${task.id}`, {
                                method: "DELETE",
                              });
                              await refreshProject(selectedProjectId);
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="collab-muted">
                    {isVi ? "Chưa có việc nào." : "No tasks yet."}
                  </p>
                )}
              </section>
            )}
            {projectPane === "evidence" && (
              <section className="collab-card">
                <h3>
                  {isVi
                    ? "Nguồn và paper dùng chung"
                    : "Shared evidence and papers"}
                </h3>
                <p className="collab-muted">
                  {isVi
                    ? "Chỉ metadata và ghi chú bạn chủ động thêm vào đây được chia sẻ. Paper lưu riêng trong tài khoản vẫn riêng tư."
                    : "Only references you intentionally add are shared. Your personal paper library stays private."}
                </p>
                {projectDetail.project.my_access >= 3 && (
                  <form className="collab-evidence-form" onSubmit={addEvidence}>
                    <input
                      value={evidenceTitle}
                      onChange={(event) => setEvidenceTitle(event.target.value)}
                      placeholder={
                        isVi ? "Tên paper hoặc nguồn" : "Paper or source title"
                      }
                      maxLength={300}
                    />
                    <input
                      value={evidenceUrl}
                      onChange={(event) => setEvidenceUrl(event.target.value)}
                      placeholder="https://arxiv.org/abs/…"
                      type="url"
                      maxLength={2000}
                    />
                    <input
                      value={evidenceDoi}
                      onChange={(event) => setEvidenceDoi(event.target.value)}
                      placeholder="DOI (optional)"
                      maxLength={200}
                    />
                    <textarea
                      className="collab-evidence-note"
                      value={evidenceNote}
                      onChange={(event) => setEvidenceNote(event.target.value)}
                      placeholder={
                        isVi
                          ? "Ghi chú chung về nguồn (không bắt buộc)"
                          : "Shared source note (optional)"
                      }
                      aria-label={
                        isVi ? "Ghi chú chung về nguồn" : "Shared source note"
                      }
                      maxLength={2000}
                    />
                    <button
                      type="submit"
                      disabled={
                        busy || !evidenceTitle.trim() || !evidenceUrl.trim()
                      }
                    >
                      <Plus size={16} />
                      {isVi ? "Thêm nguồn" : "Add source"}
                    </button>
                  </form>
                )}
                {projectDetail.project.my_access >= 3 && (
                  <SavedPaperPicker
                    key={projectDetail.project.field}
                    apiBase={apiBase}
                    language={language}
                    field={projectDetail.project.field}
                    onPick={addSavedPaper}
                  />
                )}
                {projectDetail.evidence.length ? (
                  projectDetail.evidence.map((item) => (
                    <div className="collab-evidence" key={item.id}>
                      <BookOpen size={18} />
                      <div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title}
                          <ArrowRight size={14} />
                        </a>
                        <small>{item.doi || item.url}</small>
                        {item.note && (
                          <p className="collab-muted">{item.note}</p>
                        )}
                      </div>
                      {projectDetail.project.my_access >= 3 && (
                        <button
                          type="button"
                          className="collab-icon-action"
                          disabled={busy}
                          aria-label={
                            isVi ? "Xóa nguồn chung" : "Remove shared source"
                          }
                          onClick={() =>
                            void act(async () => {
                              await api(apiBase, `/evidence/${item.id}`, {
                                method: "DELETE",
                              });
                              await refreshProject(selectedProjectId);
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="collab-muted">
                    {isVi ? "Chưa có nguồn chung." : "No shared evidence yet."}
                  </p>
                )}
              </section>
            )}
            {projectPane === "members" && (
              <section className="collab-card">
                <h3>
                  {isVi ? "Cộng tác trong dự án" : "Project collaborators"}
                </h3>
                <PendingInvitations
                  apiBase={apiBase}
                  language={language}
                  invitations={projectDetail.pending_invites}
                  onChanged={() => refreshProject(selectedProjectId)}
                />
                <p className="collab-muted">
                  {projectDetail.project.visibility === "group"
                    ? isVi
                      ? "Mọi thành viên nhóm đều có quyền chỉnh sửa dự án này. Chuyển sang chế độ hạn chế để cấp quyền từng người."
                      : "All group members can edit this project. Choose restricted visibility for individual access."
                    : isVi
                      ? "Chỉ người được mời có thể vào dự án."
                      : "Only invited members can enter this project."}
                </p>
                {projectDetail.members.map((member) => (
                  <div className="collab-member" key={member.id}>
                    <PersonChip person={member} />
                    {projectDetail.project.my_access >= 4 ? (
                      <select
                        aria-label={`${member.display_name} permission`}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void act(async () => {
                            await api(
                              apiBase,
                              `/projects/${selectedProjectId}/members/${member.id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  role: event.target.value,
                                }),
                              },
                            );
                            await refreshProject(selectedProjectId);
                          })
                        }
                      >
                        <option value="viewer">{isVi ? "Xem" : "View"}</option>
                        <option value="commenter">
                          {isVi ? "Bình luận" : "Comment"}
                        </option>
                        <option value="editor">
                          {isVi ? "Chỉnh sửa" : "Edit"}
                        </option>
                      </select>
                    ) : (
                      <span>{member.role}</span>
                    )}
                    {projectDetail.project.my_access >= 4 && (
                      <button
                        type="button"
                        onClick={() =>
                          void act(async () => {
                            await api(
                              apiBase,
                              `/projects/${selectedProjectId}/members/${member.id}`,
                              { method: "DELETE" },
                            );
                            await refreshProject(selectedProjectId);
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
                {projectDetail.project.my_access >= 4 && (
                  <form className="collab-inline-form" onSubmit={inviteProject}>
                    <input
                      value={projectInviteName}
                      onChange={(event) =>
                        setProjectInviteName(event.target.value)
                      }
                      placeholder={isVi ? "Tên người dùng" : "Username"}
                    />
                    <select
                      value={projectInviteRole}
                      onChange={(event) =>
                        setProjectInviteRole(
                          event.target.value as typeof projectInviteRole,
                        )
                      }
                    >
                      <option value="viewer">{isVi ? "Xem" : "View"}</option>
                      <option value="commenter">
                        {isVi ? "Bình luận" : "Comment"}
                      </option>
                      <option value="editor">
                        {isVi ? "Chỉnh sửa" : "Edit"}
                      </option>
                    </select>
                    <button
                      type="submit"
                      disabled={busy || !projectInviteName.trim()}
                    >
                      <UserPlus size={16} />
                      {isVi ? "Mời" : "Invite"}
                    </button>
                  </form>
                )}
                {projectDetail.project.my_access >= 4 &&
                  projectDetail.project.group_id && (
                    <button
                      type="button"
                      className="collab-secondary-button"
                      onClick={() =>
                        void act(async () => {
                          const visibility =
                            projectDetail.project.visibility === "group"
                              ? "restricted"
                              : "group";
                          await api(apiBase, `/projects/${selectedProjectId}`, {
                            method: "PATCH",
                            body: JSON.stringify({ visibility }),
                          });
                          await refreshProject(selectedProjectId);
                          await refresh();
                        })
                      }
                    >
                      {projectDetail.project.visibility === "group"
                        ? isVi
                          ? "Giới hạn dự án theo lời mời"
                          : "Restrict to invited members"
                        : isVi
                          ? "Cho cả nhóm xem và sửa"
                          : "Open to group members"}
                    </button>
                  )}
              </section>
            )}
          </div>
        ) : (
          <div className="collab-dashboard">
            <section className="collab-card collab-dashboard__list">
              <div className="collab-section-title">
                <div>
                  <span className="collab-kicker">
                    {isVi ? "THƯ VIỆN DỰ ÁN" : "PROJECT LIBRARY"}
                  </span>
                  <h2>
                    {initialField
                      ? fieldName(initialField, language)
                      : isVi
                        ? "Dự án của bạn"
                        : "Your projects"}
                  </h2>
                </div>
                <small>
                  {activeProjects.length} {isVi ? "dự án" : "projects"}
                </small>
              </div>
              {activeProjects.length ? (
                <div className="collab-project-cards">
                  {activeProjects.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => openProject(item.id)}
                    >
                      <span className="collab-project-glyph">
                        {fields.find((field) => field.id === item.field)?.glyph}
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {fieldName(item.field, language)} ·{" "}
                          {item.group_id
                            ? groups.find((group) => group.id === item.group_id)
                                ?.name || (isVi ? "Nhóm" : "Group")
                            : isVi
                              ? "Cá nhân"
                              : "Personal"}{" "}
                          · {item.status}
                        </small>
                        <em>
                          {item.description ||
                            (isVi
                              ? "Mở không gian nghiên cứu"
                              : "Open research space")}
                        </em>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="collab-empty">
                  <FolderPlus size={30} />
                  <strong>
                    {isVi
                      ? "Chưa có dự án trong lĩnh vực này"
                      : "No projects in this field yet"}
                  </strong>
                  <p>
                    {isVi
                      ? "Tạo dự án cá nhân hoặc đưa cả nhóm vào một mục tiêu nghiên cứu chung."
                      : "Start personally or bring a group together around a research goal."}
                  </p>
                </div>
              )}
              {sharedPages.filter(
                (page) => !fieldFilter || page.field === fieldFilter,
              ).length > 0 && (
                <div className="collab-shared-pages">
                  <h3>
                    {isVi ? "Trang được chia sẻ với bạn" : "Shared with you"}
                  </h3>
                  <div className="collab-project-cards">
                    {sharedPages
                      .filter(
                        (page) => !fieldFilter || page.field === fieldFilter,
                      )
                      .map((page) => (
                        <button
                          type="button"
                          key={page.id}
                          onClick={() => {
                            setSelectedProjectId(null);
                            setProjectDetail(null);
                            openPage(page.id);
                          }}
                        >
                          <FileText size={22} />
                          <span>
                            <strong>{page.title}</strong>
                            <small>
                              {page.project_name} ·{" "}
                              {fieldName(page.field, language)} ·{" "}
                              {page.share_role}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {archivedProjects.length > 0 && (
                <details className="collab-archived">
                  <summary>
                    {isVi ? "Dự án đã lưu trữ" : "Archived projects"} ·{" "}
                    {archivedProjects.length}
                  </summary>
                  {archivedProjects.map((item) => (
                    <button
                      type="button"
                      className="collab-archived__item"
                      key={item.id}
                      onClick={() => openProject(item.id)}
                    >
                      <span>{item.name}</span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </details>
              )}
            </section>
            <section className="collab-card collab-dashboard__create">
              <span className="collab-kicker">
                {isVi ? "BẮT ĐẦU" : "GET STARTED"}
              </span>
              <h2>{isVi ? "Dự án nghiên cứu mới" : "New research project"}</h2>
              <form className="collab-form" onSubmit={createProject}>
                <label>
                  {isVi ? "Tên dự án" : "Project name"}
                  <input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder={
                      isVi
                        ? "Ví dụ: Đánh giá RAG tiếng Việt"
                        : "E.g. Evaluating Vietnamese RAG"
                    }
                    maxLength={100}
                  />
                </label>
                <label>
                  {isVi ? "Lĩnh vực chính" : "Primary field"}
                  <select
                    value={projectField}
                    onChange={(event) =>
                      setProjectField(event.target.value as FieldId)
                    }
                  >
                    {fields.map((field) => (
                      <option value={field.id} key={field.id}>
                        {field[language]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {isVi ? "Chuyên đề" : "Specialty"}
                  <input
                    value={projectCategory}
                    onChange={(event) => setProjectCategory(event.target.value)}
                    placeholder={isVi ? "Ví dụ: LLM / RAG" : "E.g. LLM / RAG"}
                    maxLength={80}
                  />
                </label>
                <label>
                  {isVi ? "Không gian" : "Space"}
                  <select
                    value={projectGroup}
                    onChange={(event) => setProjectGroup(event.target.value)}
                  >
                    <option value="personal">
                      {isVi ? "Riêng tư · chỉ mình tôi" : "Private · only me"}
                    </option>
                    {groups.map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
                {projectGroup !== "personal" && (
                  <label>
                    {isVi ? "Ai trong nhóm được truy cập?" : "Group access"}
                    <select
                      value={projectVisibility}
                      onChange={(event) =>
                        setProjectVisibility(
                          event.target.value as typeof projectVisibility,
                        )
                      }
                    >
                      <option value="group">
                        {isVi
                          ? "Toàn nhóm cùng sửa"
                          : "All group members can edit"}
                      </option>
                      <option value="restricted">
                        {isVi
                          ? "Chỉ thành viên được mời"
                          : "Invited members only"}
                      </option>
                    </select>
                  </label>
                )}
                <label>
                  {isVi ? "Mục tiêu" : "Goal"}
                  <textarea
                    value={projectDescription}
                    onChange={(event) =>
                      setProjectDescription(event.target.value)
                    }
                    placeholder={
                      isVi
                        ? "Nêu câu hỏi và kết quả mong muốn…"
                        : "State your question and desired outcome…"
                    }
                    maxLength={2000}
                  />
                </label>
                <button type="submit" disabled={busy || !projectName.trim()}>
                  <Plus size={17} />
                  {isVi ? "Tạo dự án" : "Create project"}
                </button>
              </form>
            </section>
          </div>
        ))}
      {!loading && user.public_name && tab === "groups" && (
        <div className="collab-dashboard">
          <section className="collab-card">
            <div className="collab-section-title">
              <div>
                <span className="collab-kicker">
                  {isVi ? "CÙNG NGHIÊN CỨU" : "RESEARCH TOGETHER"}
                </span>
                <h2>{isVi ? "Nhóm của bạn" : "Your groups"}</h2>
              </div>
              <small>{groups.length}</small>
            </div>
            <div className="collab-group-list">
              {groups.map((group) => (
                <button
                  type="button"
                  key={group.id}
                  className={selectedGroupId === group.id ? "is-active" : ""}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <span>
                    <Users size={20} />
                  </span>
                  <strong>{group.name}</strong>
                  <small>
                    {group.members.length} {isVi ? "thành viên" : "members"}
                  </small>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
            {selectedGroup && (
              <div className="collab-group-detail">
                <h3>{selectedGroup.name}</h3>
                <p>
                  {selectedGroup.description ||
                    (isVi
                      ? "Không gian nghiên cứu kín của nhóm."
                      : "A private research space for the group.")}
                </p>
                {["owner", "admin"].includes(selectedGroup.my_role) && (
                  <form className="collab-inline-form" onSubmit={inviteGroup}>
                    <input
                      value={groupInviteName}
                      onChange={(event) =>
                        setGroupInviteName(event.target.value)
                      }
                      placeholder={
                        isVi ? "Tên người dùng cần mời" : "Username to invite"
                      }
                    />
                    <button
                      type="submit"
                      disabled={busy || !groupInviteName.trim()}
                    >
                      <UserPlus size={16} />
                      {isVi ? "Mời vào nhóm" : "Invite to group"}
                    </button>
                  </form>
                )}
                <GroupManagement
                  apiBase={apiBase}
                  language={language}
                  group={selectedGroup}
                  userId={user.id}
                  onChanged={async (removed) => {
                    await refresh();
                    if (removed) setSelectedGroupId(null);
                  }}
                />
              </div>
            )}
            {!groups.length && (
              <div className="collab-empty">
                <Users size={28} />
                <p>
                  {isVi
                    ? "Chưa có nhóm nào. Tạo nhóm để cùng phát triển nhiều dự án."
                    : "No groups yet. Create one for long-term research together."}
                </p>
              </div>
            )}
            {archivedGroups.length > 0 && (
              <details className="collab-archived">
                <summary>
                  {isVi ? "Nhóm đã lưu trữ" : "Archived groups"} ·{" "}
                  {archivedGroups.length}
                </summary>
                {archivedGroups.map((group) => (
                  <div key={group.id} className="collab-archived__item">
                    <span>{group.name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(apiBase, `/groups/${group.id}/restore`, {
                            method: "POST",
                          });
                          await refresh();
                        })
                      }
                    >
                      {isVi ? "Khôi phục" : "Restore"}
                    </button>
                  </div>
                ))}
              </details>
            )}
          </section>
          <section className="collab-card collab-dashboard__create">
            <span className="collab-kicker">
              {isVi ? "NHÓM MỚI" : "NEW GROUP"}
            </span>
            <h2>{isVi ? "Tạo nhóm nghiên cứu" : "Create research group"}</h2>
            <form className="collab-form" onSubmit={createGroup}>
              <label>
                {isVi ? "Tên nhóm" : "Group name"}
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder={isVi ? "Ví dụ: AI Lab" : "E.g. AI Lab"}
                  maxLength={80}
                />
              </label>
              <label>
                {isVi ? "Mô tả" : "Description"}
                <textarea
                  value={groupDescription}
                  onChange={(event) => setGroupDescription(event.target.value)}
                  placeholder={
                    isVi
                      ? "Nhóm đang nghiên cứu điều gì?"
                      : "What does this group study?"
                  }
                  maxLength={1000}
                />
              </label>
              <p className="collab-muted">
                <ShieldCheck size={15} />
                {isVi
                  ? "Nhóm kín mặc định. Chỉ người được mời và chấp nhận mới tham gia."
                  : "Private by default. People join only after accepting an invitation."}
              </p>
              <button
                type="submit"
                disabled={busy || groupName.trim().length < 2}
              >
                <Plus size={16} />
                {isVi ? "Tạo nhóm" : "Create group"}
              </button>
            </form>
          </section>
        </div>
      )}
      {!loading && user.public_name && tab === "people" && (
        <div className="collab-dashboard">
          <section className="collab-card">
            <span className="collab-kicker">
              {isVi ? "TÌM ĐÚNG NGƯỜI" : "FIND THE RIGHT PERSON"}
            </span>
            <h2>{isVi ? "Kết nối nghiên cứu" : "Research connections"}</h2>
            <p className="collab-muted">
              {isVi
                ? "Tìm theo tên người dùng duy nhất. Kết bạn không tự mở bất kỳ ghi chú hay dự án nào."
                : "Search by unique username. Connecting never opens a page or project automatically."}
            </p>
            <button
              type="button"
              className="collab-secondary-button"
              onClick={onEditProfile}
            >
              {isVi ? "Chỉnh sửa tên trong hồ sơ" : "Edit name in profile"} ·{" "}
              {user.public_name}
            </button>
            <div className="collab-search">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  isVi ? "Nhập ít nhất 2 ký tự…" : "Type at least 2 characters…"
                }
              />
            </div>
            {people.map((person) => (
              <div className="collab-person-result" key={person.id}>
                <PersonChip person={person} />
                <button
                  type="button"
                  disabled={
                    busy ||
                    connections.some(
                      (item) =>
                        item.person.id === person.id &&
                        ["pending", "accepted"].includes(item.status),
                    )
                  }
                  onClick={() => requestConnection(person)}
                >
                  <UserPlus size={16} />
                  {isVi ? "Kết nối" : "Connect"}
                </button>
              </div>
            ))}
          </section>
          <section className="collab-card">
            <h2>{isVi ? "Danh sách kết nối" : "Your connections"}</h2>
            {connections
              .filter(
                (item) =>
                  (item.status === "pending" &&
                    item.direction === "outgoing") ||
                  item.status === "blocked",
              )
              .map((item) => (
                <div className="collab-person-result" key={item.id}>
                  <PersonChip person={item.person} />
                  <small>
                    {item.status === "blocked"
                      ? isVi
                        ? "Đã chặn"
                        : "Blocked"
                      : isVi
                        ? "Đã gửi lời mời"
                        : "Request sent"}
                  </small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(apiBase, `/connections/${item.id}`, {
                          method: "DELETE",
                        });
                        await refresh();
                      })
                    }
                  >
                    {item.status === "blocked"
                      ? isVi
                        ? "Bỏ chặn"
                        : "Unblock"
                      : isVi
                        ? "Hủy"
                        : "Cancel"}
                  </button>
                </div>
              ))}
            {connections
              .filter((item) => item.status === "accepted")
              .map((item) => (
                <div className="collab-person-result" key={item.id}>
                  <PersonChip person={item.person} />
                  <button
                    type="button"
                    title={isVi ? "Chặn" : "Block"}
                    onClick={() => respondConnection(item, "block")}
                  >
                    <ShieldCheck size={15} />
                  </button>
                </div>
              ))}
            {!connections.some((item) => item.status === "accepted") && (
              <p className="collab-muted">
                {isVi
                  ? "Chưa có kết nối. Bạn vẫn có thể mời trực tiếp vào nhóm bằng tên người dùng."
                  : "No connections yet. You can still invite someone directly to a group by username."}
              </p>
            )}
          </section>
        </div>
      )}
      {!loading && user.public_name && tab === "inbox" && (
        <section className="collab-card collab-inbox">
          <h2>{isVi ? "Lời mời đang chờ" : "Pending invitations"}</h2>
          {invites.map((item) => (
            <div className="collab-invite" key={item.id}>
              <span className="collab-invite__icon">
                {item.kind === "group" ? (
                  <Users size={20} />
                ) : item.kind === "project" ? (
                  <FolderPlus size={20} />
                ) : (
                  <FileText size={20} />
                )}
              </span>
              <div>
                <strong>{item.target_title}</strong>
                <small>
                  {item.sender.display_name} · {item.kind} · {item.role}
                </small>
              </div>
              <button
                type="button"
                onClick={() => respondInvite(item, "accept")}
                disabled={busy}
              >
                <Check size={16} />
                {isVi ? "Chấp nhận" : "Accept"}
              </button>
              <button
                type="button"
                onClick={() => respondInvite(item, "decline")}
                disabled={busy}
              >
                {isVi ? "Từ chối" : "Decline"}
              </button>
            </div>
          ))}
          {connections
            .filter(
              (item) =>
                item.status === "pending" && item.direction === "incoming",
            )
            .map((item) => (
              <div className="collab-invite" key={item.id}>
                <span className="collab-invite__icon">
                  <UserPlus size={20} />
                </span>
                <div>
                  <strong>{item.person.display_name}</strong>
                  <small>
                    {item.person.public_name} ·{" "}
                    {isVi ? "Muốn kết nối" : "Connection request"}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => respondConnection(item, "accept")}
                >
                  <Check size={16} />
                  {isVi ? "Chấp nhận" : "Accept"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => respondConnection(item, "decline")}
                >
                  {isVi ? "Từ chối" : "Decline"}
                </button>
              </div>
            ))}
          {!invites.length &&
            !connections.some(
              (item) =>
                item.status === "pending" && item.direction === "incoming",
            ) && (
              <div className="collab-empty">
                <MessageCircle size={28} />
                <p>
                  {isVi ? "Chưa có lời mời nào." : "No invitations right now."}
                </p>
              </div>
            )}
        </section>
      )}
    </div>
  );
}
