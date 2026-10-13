import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  CalendarDays,
  FolderPlus,
  MessageCircle,
  Plus,
  Users,
} from "lucide-react";
import type { Group, Project } from "./CollaborationHub";
import { domains, type ResearchDomainId } from "./DomainHub";
import type { Language } from "./ProductViews";
import { DiscussionSpace, useVisibleRefresh } from "./DiscussionSpace";
import { MeetingsPanel } from "./MeetingsPanel";
import { discussionError } from "./discussion";
import { socialRequest } from "./social";
import "./GroupSpace.css";

type View = "projects" | "discussion" | "meetings" | "members";
function groupView(id: string): View {
  const match = new RegExp(
    `^#/collab/group/${id}(?:\\?view=(projects|discussion|meetings|members))?$`,
  ).exec(window.location.hash);
  return (match?.[1] as View) || "projects";
}
export function GroupSpace({
  apiBase,
  group,
  language,
  userId,
  members,
  onOpenProject,
  onCreated,
}: {
  apiBase: string;
  group: Group;
  language: Language;
  userId: string;
  members: ReactNode;
  onOpenProject: (id: string) => void;
  onCreated: () => Promise<void>;
}) {
  const vi = language === "vi",
    root = useRef<HTMLElement>(null),
    request = useRef<AbortController | null>(null),
    creating = useRef(false),
    mounted = useRef(true);
  const [view, setView] = useState<View>(() => groupView(group.id)),
    [visited, setVisited] = useState<View[]>([groupView(group.id)]),
    [projects, setProjects] = useState<Project[]>([]),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [field, setField] = useState<ResearchDomainId>("artificial-intelligence"),
    [visibility, setVisibility] = useState<"group" | "restricted">("group"),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (denied) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await socialRequest<{ projects: Project[] }>(
        apiBase,
        `/collab/groups/${group.id}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setProjects(result.projects);
      setLoaded(true);
      setError("");
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (
        [401, 403, 404].includes((reason as { status?: number })?.status || 0)
      ) {
        setDenied(true);
        setProjects([]);
        setName("");
        setDescription("");
        setForm(false);
      }
      setError(discussionError(reason, vi));
    }
  }, [apiBase, group.id, vi, denied]);
  useVisibleRefresh(root, refresh);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      const next = groupView(group.id);
      setView(next);
      setVisited((old) => (old.includes(next) ? old : [...old, next]));
    };
    window.addEventListener("hashchange", sync);
    return () => {
      request.current?.abort();
      window.removeEventListener("hashchange", sync);
    };
  }, [group.id]);
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (creating.current || name.trim().length < 2) return;
    creating.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const result = await socialRequest<{ project: Project }>(
          apiBase,
          `/collab/projects?group_id=${group.id}`,
          {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              description: description.trim(),
              field,
              visibility,
            }),
          },
        );
        if (!mounted.current) return;
        setForm(false);
        setName("");
        setDescription("");
        try {
          await onCreated();
        } catch {
          /* A saved project must never be recreated because list refresh failed. */
        }
        if (mounted.current) onOpenProject(result.project.id);
      } catch (reason) {
        setError(discussionError(reason, vi));
      } finally {
        creating.current = false;
        setBusy(false);
      }
    })();
  };
  const navigation = [
    ["projects", FolderPlus, vi ? "Dự án của nhóm" : "Group projects"],
    ["discussion", MessageCircle, vi ? "Thảo luận chung" : "Group discussion"],
    [
      "meetings",
      CalendarDays,
      vi ? "Lịch họp & biên bản" : "Meetings & minutes",
    ],
    ["members", Users, vi ? "Thành viên & cài đặt" : "Members & settings"],
  ] as const;
  return (
    <section
      ref={root}
      className="group-space"
      aria-label={vi ? "Không gian nhóm" : "Group space"}
    >
      <aside>
        <h3>{group.name}</h3>
        <p>
          {group.description ||
            (vi
              ? "Không gian nghiên cứu kín của nhóm."
              : "A private research space for your group.")}
        </p>
        <nav aria-label={vi ? "Tiện ích nhóm" : "Group tools"}>
          {navigation.map(([id, Icon, label]) => (
            <button
              type="button"
              key={id}
              disabled={denied}
              className={view === id ? "is-active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id);
                setVisited((old) => (old.includes(id) ? old : [...old, id]));
                window.location.hash = `#/collab/group/${group.id}${id === "projects" ? "" : `?view=${id}`}`;
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="group-space-content">
        {error && (
          <p role="alert" className="collab-alert is-error">
            {error}
          </p>
        )}
        {denied ? (
          <button type="button" onClick={() => setDenied(false)}>
            {vi ? "Kiểm tra lại quyền" : "Check access again"}
          </button>
        ) : (
          <>
            <div hidden={view !== "projects"}>
              <header className="discussion-toolbar">
                <div>
                  <h2>{vi ? "Dự án của nhóm" : "Group projects"}</h2>
                  <p>
                    {vi
                      ? "Một nhóm, nhiều dự án. Mỗi dự án giữ quyền truy cập riêng."
                      : "One group, multiple projects. Each project keeps its own access policy."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setForm((value) => !value)}
                >
                  <Plus size={16} />
                  {vi ? "Tạo dự án trong nhóm" : "Create group project"}
                </button>
              </header>
              <p className="discussion-privacy">
                {vi
                  ? "Chỉ hiển thị dự án bạn được phép mở. Notebook cá nhân ở Fields không tự chuyển vào nhóm."
                  : "Only projects you can access are shown. Personal Fields notebooks are not moved into the group."}
              </p>
              {form && (
                <form className="meeting-form" onSubmit={create}>
                  <label>
                    {vi ? "Tên dự án" : "Project name"}
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      disabled={busy}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label>
                    {vi ? "Mô tả" : "Description"}
                    <textarea
                      disabled={busy}
                      maxLength={2000}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                  <label>
                    {vi ? "Lĩnh vực" : "Field"}
                    <select
                      disabled={busy}
                      value={field}
                      onChange={(event) =>
                        setField(event.target.value as ResearchDomainId)
                      }
                    >
                      {domains.map((domain) => (
                        <option value={domain.id} key={domain.id}>
                          {domain[vi ? "vi" : "en"].title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {vi ? "Quyền truy cập" : "Access"}
                    <select
                      disabled={busy}
                      value={visibility}
                      onChange={(event) =>
                        setVisibility(
                          event.target.value as "group" | "restricted",
                        )
                      }
                    >
                      <option value="group">
                        {vi
                          ? "Toàn nhóm có thể chỉnh sửa"
                          : "Whole group can edit"}
                      </option>
                      <option value="restricted">
                        {vi
                          ? "Giới hạn: chỉ người được mời và quản trị nhóm"
                          : "Restricted: invitees and group managers"}
                      </option>
                    </select>
                  </label>
                  <button disabled={busy || name.trim().length < 2}>
                    {vi ? "Tạo và mở dự án" : "Create and open project"}
                  </button>
                </form>
              )}
              <div className="group-project-list">
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span className="group-project-icon">
                      <FolderPlus size={21} />
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        {project.visibility === "group"
                          ? vi
                            ? "Toàn nhóm"
                            : "Group-wide"
                          : vi
                            ? "Giới hạn"
                            : "Restricted"}{" "}
                        ·{" "}
                        {project.status === "archived"
                          ? vi
                            ? "Lưu trữ · chỉ đọc"
                            : "Archived · read-only"
                          : vi
                            ? "Đang hoạt động"
                            : "Active"}
                      </small>
                      {project.description && (
                        <small>{project.description}</small>
                      )}
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
              {!projects.length && (
                <p className="discussion-empty">
                  {loaded
                    ? vi
                      ? "Chưa có dự án bạn có thể mở. Tạo dự án đầu tiên cho nhóm này."
                      : "No accessible projects yet. Create the first project for this group."
                    : vi
                      ? "Đang tải dự án…"
                      : "Loading projects…"}
                </p>
              )}
            </div>
            {visited.includes("discussion") && (
              <div hidden={view !== "discussion"}>
                <DiscussionSpace
                  key={`${userId}:${group.id}`}
                  apiBase={apiBase}
                  scope={{ kind: "group", id: group.id }}
                  language={language}
                  userId={userId}
                />
              </div>
            )}
            {visited.includes("meetings") && (
              <div hidden={view !== "meetings"}>
                <MeetingsPanel
                  key={`${userId}:${group.id}`}
                  apiBase={apiBase}
                  scope={{ kind: "group", id: group.id }}
                  language={language}
                  userId={userId}
                />
              </div>
            )}
            {view === "members" && members}
          </>
        )}
      </div>
    </section>
  );
}
