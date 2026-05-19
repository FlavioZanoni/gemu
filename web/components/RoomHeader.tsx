"use client";

import { useState } from "react";

type RoomHeaderProps = {
  roomName: string;
  gameType: string;
  gameName: string;
  playerCount: number;
  maxPlayers: number;
  roomId: string;
  joinCode?: string;
  onLeave: () => void;
};

export function RoomHeader({
  roomName,
  gameType,
  gameName,
  playerCount,
  maxPlayers,
  roomId,
  joinCode,
  onLeave,
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);

  const inviteUrl = typeof window !== "undefined"
    ? `${window.location.origin}/room/${roomId}${joinCode ? `?code=${joinCode}` : ""}`
    : "";

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="glass-panel retro-card flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="font-display text-2xl text-(--retro-cream)">
          {roomName}
        </h1>
        <p className="text-sm text-(--retro-cream)/75">
          Game: {gameName || gameType} · Players {playerCount}/{maxPlayers || "∞"}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          className={`retro-btn border-2 border-(--retro-cream) px-4 py-2 text-sm font-semibold ${
            copied
              ? "border-(--accent-2) bg-(--accent-2) text-(--retro-ink)"
              : "bg-(--surface) text-(--retro-cream)"
          }`}
          onClick={copyInvite}
        >
          {copied ? "Copied!" : "Invite"}
        </button>
        <button
          className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-4 py-2 text-sm font-semibold text-(--retro-cream)"
          onClick={onLeave}
        >
          Leave room
        </button>
      </div>
    </header>
  );
}
