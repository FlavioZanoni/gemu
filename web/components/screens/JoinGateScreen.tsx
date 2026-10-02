"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AvatarDrawModal } from "./AvatarDrawModal";
import { joinErrorText } from "@/lib/joinErrors";
import { LangToggle } from "@/components/ui/LangToggle";

const inputClass =
  "w-full rounded-xl border-2 border-(--line) bg-(--bg) px-3.5 py-3 text-base font-semibold text-(--ink) placeholder:text-(--ink)/40 focus:border-(--accent-2) focus:outline-none";

/** Opening a room link without a seat: the home page's ticket card, scoped to
 *  this room. Code / password fields appear only when the room asks. */
export function JoinGateScreen({
  joinError,
  pendingJoin,
  defaultName,
  defaultAvatarUrl,
  defaultCode,
  onJoin,
  onHome,
}: {
  joinError: string | null;
  pendingJoin: boolean;
  defaultName?: string;
  defaultAvatarUrl?: string;
  defaultCode?: string;
  onJoin: (displayName: string, avatarUrl: string, joinCode?: string, password?: string) => void;
  onHome?: () => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(defaultName || "");
  const [avatarUrl, setAvatarUrl] = useState(defaultAvatarUrl || "");
  const [joinCode, setJoinCode] = useState(defaultCode || "");
  const [password, setPassword] = useState("");
  const [drawOpen, setDrawOpen] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);

  const needCode = extrasOpen || joinError === "invalid_code";
  const needPassword = extrasOpen || joinError === "invalid_password" || joinError === "password_wrong";

  const handleJoin = () => {
    if (!displayName.trim() || pendingJoin) return;
    onJoin(
      displayName.trim(),
      avatarUrl.trim(),
      joinCode.trim().toUpperCase() || undefined,
      password.trim() || undefined,
    );
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded-3xl border-2 border-(--line) bg-(--panel) p-5 shadow-[0_20px_60px_rgba(0,0,0,.4)] sm:p-7"
        onSubmit={(e) => {
          e.preventDefault();
          handleJoin();
        }}
        data-testid="join-gate"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="mono-caption">{t("home.stepRightUp")}</h1>
          <LangToggle />
        </div>

        <div className="mb-4 flex items-center gap-3.5">
          <button
            type="button"
            onClick={() => setDrawOpen(true)}
            className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-[20px] border-2 border-(--accent) bg-[#fff8e7] transition hover:brightness-95"
            aria-label={t("home.drawFace")}
          >
            {avatarUrl.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl.trim()} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center text-center font-mono text-[9px] leading-tight text-[#8a7f60]">
                {t("home.drawFace")}
                <Pencil size={16} strokeWidth={2.5} aria-hidden />
              </span>
            )}
          </button>
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-(--ink)/50">
              {t("home.yourNickname")}
            </span>
            <input
              type="text"
              value={displayName}
              maxLength={40}
              placeholder={t("home.typeIt")}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
              data-testid="gate-nick-input"
            />
          </label>
        </div>
        <AvatarDrawModal open={drawOpen} initial={avatarUrl} onClose={() => setDrawOpen(false)} onSave={setAvatarUrl} />

        {needCode ? (
          <input
            type="text"
            placeholder={t("home.joinCode")}
            value={joinCode}
            maxLength={6}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            className={`${inputClass} mb-3 text-center font-mono uppercase tracking-[0.25em]`}
            data-testid="gate-code-input"
          />
        ) : null}
        {needPassword ? (
          <input
            type="password"
            placeholder={t("home.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} mb-3`}
            data-testid="gate-password-input"
          />
        ) : null}

        {joinError ? (
          <p className="mb-3 rounded-lg bg-(--danger)/10 px-3 py-2 text-center text-xs font-semibold text-[#ffb3c1]" role="alert" data-testid="gate-error">
            {joinErrorText(joinError, t)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!displayName.trim() || pendingJoin}
          className="buzzer w-full rounded-2xl py-4 text-lg uppercase"
          style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
          data-testid="gate-join"
        >
          {pendingJoin ? t("home.joining") : t("home.joinRoom")}
        </button>

        <div className="mt-3 flex items-center justify-between gap-2">
          {!needCode || !needPassword ? (
            <button
              type="button"
              onClick={() => setExtrasOpen(true)}
              className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-(--accent-2)"
            >
              {t("join.haveCode")}
            </button>
          ) : (
            <span />
          )}
          {onHome ? (
            <button
              type="button"
              onClick={onHome}
              className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-(--ink)/50 hover:text-(--ink)"
            >
              {t("edge.backHome")}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
