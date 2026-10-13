import { useRef, useState } from "react";
import { LoaderCircle, Monitor } from "lucide-react";
import type { Language } from "./ProductViews";
import type { LoginSession } from "./authSession";
import "./LoginSession.css";

interface Props {
  language: Language;
  session: LoginSession;
  onSave: (remember: boolean) => Promise<void>;
}

const failure = (vi: boolean) =>
  vi
    ? "Chưa lưu được lựa chọn. Vui lòng kiểm tra kết nối và thử lại; Nexora chưa xác nhận thay đổi."
    : "Your choice could not be saved. Check your connection and retry; Nexora has not confirmed the change.";

export function LoginSessionSettings({ language, session, onSave }: Props) {
  const vi = language === "vi",
    inFlight = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await onSave(!session.remembered);
      setSaved(true);
    } catch {
      setError(failure(vi));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="login-session-settings">
      <h4>
        <Monitor size={17} />
        {vi ? "Đăng nhập trên trình duyệt này" : "Login in this browser"}
      </h4>
      <p>
        {session.remembered
          ? vi
            ? "Đang ghi nhớ đăng nhập. Bạn vẫn cần đăng nhập lại khi phiên hết hạn hoặc sau khi đăng xuất."
            : "Login is remembered. Sign in again after your session expires or you sign out."
          : vi
            ? `Không ghi nhớ đăng nhập lâu dài. Phiên có thời hạn tối đa ${session.session_hours} giờ; trình duyệt có thể kết thúc sớm hơn.`
            : `Long-term login is off. This session lasts at most ${session.session_hours} hours; the browser may end it sooner.`}
      </p>
      <p>
        {vi
          ? `Nexora tự ghi nhớ mỗi lần đăng nhập mới, tối đa ${session.persistent_days} ngày. Trên máy dùng chung, hãy đăng xuất khi dùng xong hoặc tắt ghi nhớ cho phiên hiện tại.`
          : `Nexora automatically remembers each new login for up to ${session.persistent_days} days. On shared devices, sign out when finished or disable remembering for this session.`}
      </p>
      {session.expires_at && (
        <small>
          {vi ? "Phiên hết hạn: " : "Session expires: "}
          {new Date(session.expires_at).toLocaleString(vi ? "vi-VN" : "en-US")}
        </small>
      )}
      <button
        type="button"
        className="button button--secondary"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy && <LoaderCircle size={16} className="spin" />}
        {session.remembered
          ? vi
            ? "Tắt ghi nhớ đăng nhập"
            : "Stop remembering login"
          : vi
            ? "Ghi nhớ đăng nhập"
            : "Remember login"}
      </button>
      {error && (
        <p className="login-session-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <small role="status">
          {vi
            ? "Đã lưu lựa chọn cho phiên hiện tại trên trình duyệt này."
            : "Choice saved for the current session in this browser."}
        </small>
      )}
    </div>
  );
}
