import type { PublicPerson } from "./social";

export type DiscussionScope = { kind: "group" | "project"; id: string };
export type Channel = {
  title: string;
  access: number;
  can_write: boolean;
  can_rsvp: boolean;
  members: PublicPerson[];
  muted: boolean;
  unread_count: number;
  pinned: ChatMessage[];
};
export type ChatMessage = {
  id: string;
  seq: number;
  body: string;
  author: PublicPerson | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
  pinned: boolean;
  reply_count: number;
  context: { kind: string; id: string; title: string; href: string } | null;
};
export type MessagePage = {
  messages: ChatMessage[];
  refreshed: ChatMessage[];
  next_cursor: number | null;
  through: number;
};
export type Meeting = {
  id: string;
  title: string;
  created_by: string;
  starts_at: string;
  ends_at: string;
  timezone_label: string;
  meeting_url: string;
  agenda: string;
  notes: string;
  status: "scheduled" | "cancelled";
  version: number;
  client_id: string;
  organizer: PublicPerson;
  attendees: { person: PublicPerson; response: "yes" | "maybe" | "no" }[];
  my_response: "yes" | "maybe" | "no" | null;
};
export const discussionPath = (scope: DiscussionScope) =>
  `/discussions/spaces/${scope.kind}/${scope.id}`;
export function discussionError(error: unknown, vi: boolean) {
  const status = (error as { status?: number })?.status;
  if ([401, 403, 404].includes(status || 0))
    return vi
      ? "Không còn quyền mở không gian này hoặc phiên đăng nhập đã hết hạn."
      : "This space is unavailable or your session has expired.";
  if (status === 409)
    return vi
      ? "Dữ liệu hoặc quyền đã thay đổi. Hãy kiểm tra bản mới trước khi thử lại."
      : "Data or permissions changed. Review the latest version before retrying.";
  if (status === 429)
    return vi
      ? "Bạn thao tác quá nhanh. Chờ một phút rồi thử lại."
      : "Too many actions. Wait a minute and retry.";
  if (status === 422)
    return vi
      ? "Kiểm tra nội dung, thành viên được nhắc và đường link/thời gian hợp lệ."
      : "Check the content, mentioned members, and valid link/times.";
  return vi
    ? "Chưa kết nối được. Nội dung chưa gửi vẫn được giữ để bạn thử lại."
    : "Unable to connect. Your unsent content is preserved for retry.";
}
export function mergeMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
) {
  const values = new Map(previous.map((message) => [message.id, message]));
  incoming.forEach((message) => values.set(message.id, message));
  return [...values.values()].sort((a, b) => a.seq - b.seq);
}
export function safeMeetingLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function calendarFile(meeting: Meeting) {
  const escape = (value: string) =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  const time = (value: string) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nexora//Research meetings//EN",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@nexora`,
    `DTSTAMP:${time(new Date().toISOString())}`,
    `DTSTART:${time(meeting.starts_at)}`,
    `DTEND:${time(meeting.ends_at)}`,
    `SUMMARY:${escape(meeting.title)}`,
    `DESCRIPTION:${escape(meeting.agenda)}`,
    `URL:${safeMeetingLink(meeting.meeting_url) || ""}`,
    `STATUS:${meeting.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // RFC 5545 folding is measured in UTF-8 bytes, not JS characters.
  return (
    lines
      .map((line) => {
        const parts: string[] = [];
        let current = "",
          size = 0;
        for (const ch of line) {
          const bytes = new TextEncoder().encode(ch).length;
          if (size + bytes > 73) {
            parts.push(current);
            current = " ";
            size = 1;
          }
          current += ch;
          size += bytes;
        }
        return [...parts, current].join("\r\n");
      })
      .join("\r\n") + "\r\n"
  );
}
