import type { Metadata } from "next";

// Rooms are ephemeral and code-gated — never index them.
export const metadata: Metadata = {
  title: "Game room",
  robots: { index: false, follow: false },
};

export default function RoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
