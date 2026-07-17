"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui";
import { AvatarDrawModal } from "./AvatarDrawModal";

export function JoinGateScreen({
  joinError,
  pendingJoin,
  defaultName,
  defaultAvatarUrl,
  onJoin,
}: {
  joinError: string | null;
  pendingJoin: boolean;
  defaultName?: string;
  defaultAvatarUrl?: string;
  onJoin: (displayName: string, avatarUrl: string, joinCode?: string, password?: string) => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(defaultName || "");
  const [avatarUrl, setAvatarUrl] = useState(defaultAvatarUrl || "");
  const [joinCode, setJoinCode] = useState("");
  const [password, setPassword] = useState("");
  const [drawOpen, setDrawOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleJoin = () => {
    if (!displayName.trim()) {
      setLocalError(t("home.displayName") + " is required.");
      return;
    }
    onJoin(displayName.trim(), avatarUrl.trim(), joinCode.trim() || undefined, password.trim() || undefined);
  };

  const getErrorMessage = (code: string) => {
    const errors: Record<string, string> = {
      name_taken: t("edge.errorNameTaken"),
      invalid_password: t("edge.errorInvalidPassword"),
      password_wrong: t("edge.errorInvalidPassword"),
      room_full: t("edge.errorRoomFull"),
      invalid_code: t("edge.errorInvalidCode"),
      not_found: t("edge.errorNotFound"),
      invalid_room: t("edge.errorNotFound"),
      session_in_room: t("edge.errorSessionInRoom"),
      not_enough_players: t("edge.errorNotEnoughPlayers"),
    };
    return errors[code] || code;
  };

  return (
    <div className="min-h-screen bg-(--bg) flex items-center justify-center px-6 py-8">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border-2 border-(--line) bg-(--panel) p-8">
          <h1 className="slab text-3xl mb-2">{t("home.joinRoomTitle")}</h1>
          <p className="text-(--ink)/70 text-sm mb-6">
            {t("home.joinRoomDesc")}
          </p>

          <div className="space-y-4">
            {/* Avatar: click to draw in the full modal */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-(--accent-2)">
                {t("home.drawYourAvatar")}
              </label>
              <button
                type="button"
                onClick={() => setDrawOpen(true)}
                className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-(--accent) bg-[#fff8e7] transition hover:brightness-95"
              >
                {avatarUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl.trim()}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-center font-mono text-[9px] leading-tight text-[#8a7f60] flex flex-col items-center">
                    {t("home.drawFace")}
                    <br />
                    <Pencil size={16} strokeWidth={2.5} style={{ color: "#8a7f60" }} />
                  </span>
                )}
              </button>
            </div>
            <AvatarDrawModal
              open={drawOpen}
              initial={avatarUrl}
              onClose={() => setDrawOpen(false)}
              onSave={setAvatarUrl}
            />

            {/* Inputs */}
            <input
              type="text"
              placeholder={t("home.displayName")}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setLocalError(null);
              }}
              className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
            />

            <input
              type="password"
              placeholder={t("home.joinCode")}
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value);
                setLocalError(null);
              }}
              className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
            />

            <input
              type="password"
              placeholder={t("home.password")}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setLocalError(null);
              }}
              className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
            />

            {/* Error messages */}
            {localError && (
              <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded">
                {localError}
              </p>
            )}
            {joinError && (
              <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded">
                {getErrorMessage(joinError)}
              </p>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="primary"
                size="md"
                disabled={!displayName.trim() || pendingJoin}
                onClick={handleJoin}
              >
                {pendingJoin ? t("home.joining") : t("home.joinRoom")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
