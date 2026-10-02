"use client";

import { Component, type ComponentType, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { InventionGame } from "./games/InventionGame";
import { StopGame } from "./games/StopGame";
import { GarticGame } from "./games/GarticGame";
import { GarticPhoneGame } from "./games/GarticPhoneGame";
import { CahGame } from "./games/CahGame";
import { TriviaGame } from "./games/TriviaGame";
import { FibberGame } from "./games/FibberGame";
import type { GameProps } from "./games/types";

type GameSurfaceProps = GameProps & {
  gameType: string;
  onLeave?: () => void;
};

const Games: Record<string, ComponentType<GameProps & { onLeave?: () => void }>> = {
  invention: InventionGame,
  stop: StopGame,
  gartic: GarticGame,
  garticphone: GarticPhoneGame,
  cah: CahGame,
  trivia: TriviaGame,
  fibber: FibberGame,
};

function GameCrashed({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="rounded-2xl border-2 border-dashed border-(--line) bg-(--panel) p-8 text-center"
      role="alert"
      data-testid="game-crashed"
    >
      <p className="font-display text-lg text-(--ink)">{t("shell.gameCrashed")}</p>
      <p className="mt-1 text-sm text-(--ink)/60">{t("shell.gameCrashedHint")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-full border-2 border-(--accent-2) px-4 py-2 text-sm font-bold text-(--accent-2)"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

/** Contains a game's render crash (e.g. a state shape it didn't expect) to
 *  the game area: the shell — header, Leave, pause — keeps working, and the
 *  next game.state gets a fresh try. */
class GameErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean; key: string }
> {
  constructor(props: { resetKey: string; children: ReactNode }) {
    super(props);
    this.state = { failed: false, key: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // A different game gets a clean slate.
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: boolean; key: string },
  ) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.warn("Game surface crashed", error);
  }

  render() {
    if (this.state.failed) {
      return <GameCrashed onRetry={() => this.setState({ failed: false })} />;
    }
    return this.props.children;
  }
}

export function GameSurface({
  gameType,
  playerId,
  players,
  publicState,
  privateState,
  sendAction,
  sendStream,
  isAdmin,
  onLeave,
}: GameSurfaceProps) {
  const { t } = useI18n();
  const gameProps: GameProps = {
    playerId,
    players,
    publicState,
    privateState,
    sendAction,
    sendStream,
    isAdmin,
  };

  const GameComponent = Games[gameType];
  if (!GameComponent) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-(--line) bg-(--panel) p-8 text-center text-sm text-(--ink)/60">
        {t("shell.unknownGame", { game: gameType })}
      </div>
    );
  }

  // Keyed by game type: a new game never inherits the previous one's
  // component state.
  return (
    <GameErrorBoundary resetKey={gameType}>
      {gameType === "invention" ? (
        <GameComponent key={gameType} {...gameProps} onLeave={onLeave} />
      ) : (
        <GameComponent key={gameType} {...gameProps} />
      )}
    </GameErrorBoundary>
  );
}
