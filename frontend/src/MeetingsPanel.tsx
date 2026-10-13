import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CalendarDays, Download, ExternalLink, Plus, X } from "lucide-react";
import { socialChanged, socialRequest } from "./social";
import { useNotebookConfirm } from "./NotebookTools";
import { useVisibleRefresh, type SpaceProps } from "./DiscussionSpace";
import {
  calendarFile,
  discussionError,
  discussionPath,
  safeMeetingLink,
  type Channel,
  type Meeting,
} from "./discussion";

type MeetingForm = {
  title: string;
  start: string;
  end: string;
  url: string;
  agenda: string;
  notes: string;
  client_id: string;
  meeting?: Meeting;
};
const localTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const initialForm = (): MeetingForm => {
  const start = new Date(
    Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000,
  );
  return {
    title: "",
    start: localTime(start.toISOString()),
    end: localTime(new Date(start.getTime() + 3_600_000).toISOString()),
    url: "",
    agenda: "",
    notes: "",
    client_id: crypto.randomUUID(),
  };
};
export function MeetingsPanel({
  apiBase,
  scope,
  language,
  userId,
}: SpaceProps) {
  const vi = language === "vi",
    root = useRef<HTMLElement>(null),
    path = discussionPath(scope),
    locked = useRef(false),
    controller = useRef<AbortController | null>(null),
    loaded = useRef(false);
  const [channel, setChannel] = useState<Channel | null>(null),
    [items, setItems] = useState<Meeting[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [form, setForm] = useState<MeetingForm | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [notice, setNotice] = useState("");
  const [ask, confirmation] = useNotebookConfirm(language);
  const fail = useCallback(
    (reason: unknown) => {
      if ((reason as Error)?.name === "AbortError") return;
      if (
        [401, 403, 404].includes((reason as { status?: number }).status || 0)
      ) {
        setChannel(null);
        setItems([]);
        setForm(null);
        setDenied(true);
      }
      setError(discussionError(reason, vi));
    },
    [vi],
  );
  const refresh = useCallback(async () => {
    if (denied) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const [space, page] = await Promise.all([
        socialRequest<Channel>(apiBase, path, { signal: current.signal }),
        socialRequest<{ meetings: Meeting[]; next_cursor: string | null }>(
          apiBase,
          `${path}/meetings`,
          { signal: current.signal },
        ),
      ]);
      if (current.signal.aborted) return;
      setChannel(space);
      setItems((old) => {
        const map = new Map(old.map((item) => [item.id, item]));
        page.meetings.forEach((item) => map.set(item.id, item));
        return [...map.values()];
      });
      if (!loaded.current) {
        setCursor(page.next_cursor);
        loaded.current = true;
      }
      setError("");
    } catch (reason) {
      if (!current.signal.aborted) fail(reason);
    }
  }, [apiBase, path, denied, fail]);
  useEffect(() => () => controller.current?.abort(), [path]);
  useVisibleRefresh(root, refresh);
  const run = async (work: () => Promise<void>) => {
    if (locked.current || denied) return;
    locked.current = true;
    setBusy(true);
    setError("");
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
  const payload = (value: MeetingForm, status?: string) => ({
    title: value.title,
    starts_at: new Date(value.start).toISOString(),
    ends_at: new Date(value.end).toISOString(),
    timezone_label: Intl.DateTimeFormat().resolvedOptions().timeZone,
    meeting_url: value.url,
    agenda: value.agenda,
    notes: value.notes,
    client_id: value.client_id,
    ...(value.meeting
      ? {
          expected_version: value.meeting.version,
          status: status || value.meeting.status,
        }
      : {}),
  });
  const editForm = (meeting: Meeting): MeetingForm => ({
    title: meeting.title,
    start: localTime(meeting.starts_at),
    end: localTime(meeting.ends_at),
    url: meeting.meeting_url,
    agenda: meeting.agenda,
    notes: meeting.notes,
    client_id: meeting.client_id,
    meeting,
  });
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const duration = Date.parse(form.end) - Date.parse(form.start);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 8 * 3_600_000 ||
      (form.url && !safeMeetingLink(form.url))
    ) {
      setError(
        vi
          ? "Chọn thời gian kết thúc sau bắt đầu, tối đa 8 giờ; link họp phải là HTTPS."
          : "Choose an end after the start (up to 8 hours), and an HTTPS meeting link.",
      );
      return;
    }
    void run(async () => {
      await socialRequest(
        apiBase,
        form.meeting
          ? `/discussions/meetings/${form.meeting.id}`
          : `${path}/meetings`,
        {
          method: form.meeting ? "PATCH" : "POST",
          body: JSON.stringify(payload(form)),
        },
      );
      setForm(null);
      setNotice(
        vi ? "Đã lưu lịch họp và nội dung." : "Meeting and content saved.",
      );
    });
  };
  const download = (meeting: Meeting) => {
    const url = URL.createObjectURL(
      new Blob([calendarFile(meeting)], {
        type: "text/calendar;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexora-meeting-${meeting.id}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const ordered = [...items].sort(
    (a, b) =>
      Number(a.status === "cancelled") - Number(b.status === "cancelled") ||
      Date.parse(a.starts_at) - Date.parse(b.starts_at),
  );
  return (
    <section
      ref={root}
      className="discussion-space meetings-panel"
      aria-label={vi ? "Lịch họp và biên bản" : "Meetings and minutes"}
    >
      <header className="discussion-toolbar">
        <div>
          <h2>{vi ? "Lịch họp & biên bản" : "Meetings & minutes"}</h2>
          <p>
            {vi
              ? "Agenda, phòng họp và kết quả ở cùng một nơi."
              : "Agenda, meeting room, and outcomes in one place."}
          </p>
        </div>
        {channel?.can_write && (
          <button
            type="button"
            disabled={busy || !!form}
            onClick={() => {
              setForm(initialForm());
              setNotice("");
            }}
          >
            <Plus size={16} />
            {vi ? "Lên lịch họp" : "Schedule meeting"}
          </button>
        )}
      </header>
      <p className="discussion-privacy">
        {vi
          ? "Dùng link phòng họp bên ngoài. Nexora không bật microphone/camera và không ghi âm. Giờ hiển thị theo múi giờ thiết bị của bạn."
          : "Use an external meeting room. Nexora does not activate microphone/camera or record calls. Times are shown in your device timezone."}
      </p>
      {error && (
        <p role="alert" className="collab-alert is-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {denied && (
        <button type="button" onClick={() => setDenied(false)}>
          {vi ? "Kiểm tra lại quyền" : "Check access again"}
        </button>
      )}
      {form && (
        <form className="meeting-form" onSubmit={save}>
          <header>
            <h3>
              {form.meeting
                ? vi
                  ? "Chỉnh lịch & biên bản"
                  : "Edit meeting & minutes"
                : vi
                  ? "Cuộc họp mới"
                  : "New meeting"}
            </h3>
            <button
              type="button"
              disabled={busy}
              aria-label={vi ? "Đóng biểu mẫu" : "Close form"}
              onClick={() => setForm(null)}
            >
              <X size={16} />
            </button>
          </header>
          <label>
            {vi ? "Tên cuộc họp" : "Meeting title"}
            <input
              disabled={busy}
              required
              maxLength={120}
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </label>
          <div className="meeting-time-grid">
            <label>
              {vi ? "Bắt đầu" : "Starts"}
              <input
                disabled={busy}
                required
                type="datetime-local"
                value={form.start}
                onChange={(event) =>
                  setForm({ ...form, start: event.target.value })
                }
              />
            </label>
            <label>
              {vi ? "Kết thúc" : "Ends"}
              <input
                disabled={busy}
                required
                type="datetime-local"
                value={form.end}
                onChange={(event) =>
                  setForm({ ...form, end: event.target.value })
                }
              />
            </label>
          </div>
          <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          {form.meeting && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const latest = items.find(
                  (item) => item.id === form.meeting!.id,
                );
                if (latest) setForm(editForm(latest));
              }}
            >
              {vi ? "Tải bản mới (bỏ sửa)" : "Reload latest (discard edits)"}
            </button>
          )}
          <label>
            {vi
              ? "Link phòng họp HTTPS (tùy chọn)"
              : "HTTPS meeting room (optional)"}
            <input
              disabled={busy}
              type="url"
              maxLength={1500}
              value={form.url}
              onChange={(event) =>
                setForm({ ...form, url: event.target.value })
              }
              placeholder="https://meet.google.com/…"
            />
          </label>
          <label>
            {vi ? "Agenda / nội dung cần bàn" : "Agenda / discussion topics"}
            <textarea
              disabled={busy}
              rows={3}
              maxLength={4000}
              value={form.agenda}
              onChange={(event) =>
                setForm({ ...form, agenda: event.target.value })
              }
            />
          </label>
          <label>
            {vi
              ? "Biên bản / quyết định / việc tiếp theo"
              : "Minutes / decisions / next steps"}
            <textarea
              disabled={busy}
              rows={5}
              maxLength={12000}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </label>
          <button disabled={busy || !form.title.trim()}>
            {vi ? "Lưu cuộc họp" : "Save meeting"}
          </button>
        </form>
      )}
      {ordered.map((meeting) => (
        <article
          className={`meeting-card${meeting.status === "cancelled" ? " is-cancelled" : ""}`}
          key={meeting.id}
        >
          <header>
            <CalendarDays size={21} />
            <h3>{meeting.title}</h3>
            <span>
              {meeting.status === "cancelled"
                ? vi
                  ? "Đã hủy"
                  : "Cancelled"
                : vi
                  ? "Đã lên lịch"
                  : "Scheduled"}
            </span>
          </header>
          <p>
            {new Date(meeting.starts_at).toLocaleString(vi ? "vi-VN" : "en-US")}{" "}
            → {new Date(meeting.ends_at).toLocaleString(vi ? "vi-VN" : "en-US")}
          </p>
          <small>
            {vi ? "Người tổ chức" : "Organizer"}:{" "}
            {meeting.organizer.display_name} · {meeting.timezone_label}
          </small>
          {meeting.agenda && (
            <div>
              <h4>Agenda</h4>
              <p className="discussion-body">{meeting.agenda}</p>
            </div>
          )}
          {meeting.notes && (
            <details>
              <summary>
                {vi ? "Biên bản & quyết định" : "Minutes & decisions"}
              </summary>
              <p className="discussion-body">{meeting.notes}</p>
            </details>
          )}
          <div className="meeting-attendees">
            {meeting.attendees.map((attendee) => (
              <span key={attendee.person.id}>
                {attendee.person.display_name} ·{" "}
                {attendee.response === "yes"
                  ? vi
                    ? "Tham gia"
                    : "Going"
                  : attendee.response === "maybe"
                    ? vi
                      ? "Có thể"
                      : "Maybe"
                    : vi
                      ? "Không tham gia"
                      : "Not going"}
              </span>
            ))}
          </div>
          <div className="discussion-actions">
            {meeting.status === "scheduled" &&
              safeMeetingLink(meeting.meeting_url) && (
                <a
                  href={safeMeetingLink(meeting.meeting_url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} />
                  {vi ? "Mở phòng họp" : "Open meeting room"}
                </a>
              )}
            <button type="button" onClick={() => download(meeting)}>
              <Download size={14} />
              .ics
            </button>
            {meeting.status === "scheduled" &&
              channel?.can_rsvp &&
              (["yes", "maybe", "no"] as const).map((response) => (
                <button
                  type="button"
                  key={response}
                  disabled={busy}
                  aria-pressed={meeting.my_response === response}
                  onClick={() =>
                    void run(async () => {
                      await socialRequest(
                        apiBase,
                        `/discussions/meetings/${meeting.id}/rsvp`,
                        { method: "PUT", body: JSON.stringify({ response }) },
                      );
                    })
                  }
                >
                  {response === "yes"
                    ? vi
                      ? "Tham gia"
                      : "Going"
                    : response === "maybe"
                      ? vi
                        ? "Có thể"
                        : "Maybe"
                      : vi
                        ? "Không tham gia"
                        : "Not going"}
                </button>
              ))}
            {channel?.can_write &&
              (meeting.created_by === userId || channel.access >= 4) && (
                <>
                  <button
                    type="button"
                    onClick={() => setForm(editForm(meeting))}
                  >
                    {vi ? "Sửa / viết biên bản" : "Edit / add minutes"}
                  </button>
                  {meeting.status === "scheduled" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          if (
                            !(await ask(
                              vi
                                ? `Hủy cuộc họp “${meeting.title}”? Biên bản vẫn được giữ.`
                                : `Cancel “${meeting.title}”? Minutes are kept.`,
                              {
                                title: vi ? "Hủy cuộc họp" : "Cancel meeting",
                                destructive: true,
                              },
                            ))
                          )
                            return;
                          await socialRequest(
                            apiBase,
                            `/discussions/meetings/${meeting.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify(
                                payload(editForm(meeting), "cancelled"),
                              ),
                            },
                          );
                        })
                      }
                    >
                      {vi ? "Hủy cuộc họp" : "Cancel meeting"}
                    </button>
                  )}
                </>
              )}
          </div>
        </article>
      ))}
      {!items.length && !denied && (
        <p className="discussion-empty">
          {channel
            ? vi
              ? "Chưa có lịch họp. Tạo agenda cho buổi thảo luận đầu tiên."
              : "No meetings yet. Plan your first discussion."
            : vi
              ? "Đang tải lịch họp…"
              : "Loading meetings…"}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const page = await socialRequest<{
                meetings: Meeting[];
                next_cursor: string | null;
              }>(apiBase, `${path}/meetings?before=${cursor}`);
              setItems((old) => [
                ...old,
                ...page.meetings.filter(
                  (item) => !old.some((existing) => existing.id === item.id),
                ),
              ]);
              setCursor(page.next_cursor);
            })
          }
        >
          {vi ? "Lịch sử cũ hơn" : "Older history"}
        </button>
      )}
      {confirmation}
    </section>
  );
}
