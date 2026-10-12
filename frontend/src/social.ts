export type PublicPerson = { id: string; public_name: string | null; display_name: string; avatar_url: string | null };
export type Friendship = { id: string; status: 'pending' | 'accepted'; direction: 'incoming' | 'outgoing'; person: PublicPerson; created_at: string; updated_at: string };
export type BlockedPerson = { person: PublicPerson; created_at: string };
export type NotificationItem = {
  id: number; kind: string; category: 'friends' | 'collaboration' | 'tasks'; created_at: string; read_at: string | null;
  state: string; actor: PublicPerson | null; title: string; role: string | null; target_kind: string | null;
  href: string | null; action_id: string | null;
};
export type NotificationPage = { notifications: NotificationItem[]; unread_count: number; through: number; next_cursor: number | null };

export function relationshipAction(friendship?: Friendship) {
  if (!friendship) return 'add';
  return friendship.status === 'accepted' ? 'friends' : friendship.direction === 'incoming' ? 'respond' : 'cancel';
}

export function safeSocialHref(href: string | null): string | null {
  return href && /^#\/collab\/(?:people|(?:project|page|group)\/[a-f0-9]{32})$/.test(href) ? href : null;
}

export function relativeTime(value: string, vi: boolean, current = Date.now()) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  const minutes = Math.max(0, Math.floor((current - parsed) / 60_000));
  if (minutes < 1) return vi ? 'Vừa xong' : 'Just now';
  if (minutes < 60) return vi ? `${minutes} phút trước` : `${minutes}m ago`;
  if (minutes < 1440) return vi ? `${Math.floor(minutes / 60)} giờ trước` : `${Math.floor(minutes / 60)}h ago`;
  return new Date(parsed).toLocaleDateString(vi ? 'vi-VN' : 'en-US');
}

export function roleLabel(role: string | null, vi: boolean) {
  const labels: Record<string, [string, string]> = { member: ['Thành viên', 'Member'], viewer: ['Có thể xem', 'Can view'], commenter: ['Có thể bình luận', 'Can comment'], editor: ['Có thể chỉnh sửa', 'Can edit'] };
  return role && labels[role] ? labels[role][vi ? 0 : 1] : '';
}

export function notificationText(item: NotificationItem, vi: boolean) {
  if (['unavailable', 'expired'].includes(item.state)) return vi ? 'Thông báo này không còn khả dụng' : 'This notification is no longer available';
  const person = item.actor?.display_name || (vi ? 'Một thành viên' : 'A member');
  switch (item.kind) {
    case 'friend.request': return vi ? `${person} muốn kết bạn với bạn` : `${person} sent you a friend request`;
    case 'friend.accepted': return vi ? `${person} đã chấp nhận lời mời kết bạn` : `${person} accepted your friend request`;
    case 'invite.received': return vi ? `${person} mời bạn cộng tác${item.title ? ` · ${item.title}` : ''}` : `${person} invited you to collaborate${item.title ? ` · ${item.title}` : ''}`;
    case 'invite.accepted': return vi ? `${person} đã chấp nhận lời mời${item.title ? ` · ${item.title}` : ''}` : `${person} accepted your invitation${item.title ? ` · ${item.title}` : ''}`;
    case 'task.assigned': return vi ? `${person} giao cho bạn nhiệm vụ · ${item.title}` : `${person} assigned you a task · ${item.title}`;
    default: return vi ? 'Có cập nhật mới' : 'New update';
  }
}

export async function socialRequest<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}/api${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

export function socialError(error: unknown, vi: boolean) {
  const status = (error as { status?: number })?.status;
  if (vi) {
    if (status === 429) return 'Bạn thao tác quá nhanh hoặc vừa gửi lời mời cho người này. Hãy chờ rồi thử lại; lời mời bị từ chối cần chờ ít nhất 24 giờ.';
    if (status === 409) return 'Thông tin đã thay đổi hoặc lời mời đã tồn tại. Danh sách sẽ được cập nhật lại.';
    if (status === 403 || status === 404) return 'Không thể thực hiện lúc này. Lời mời hoặc quyền truy cập có thể đã thay đổi.';
    if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    return 'Không thể kết nối dịch vụ. Hãy thử lại.';
  }
  return error instanceof Error ? error.message : 'Unable to connect. Please retry.';
}

export function socialChanged() { window.dispatchEvent(new Event('nexora:social-changed')); }
