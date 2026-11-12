import type { Metadata } from "next";

export const metadata: Metadata = { title: "Checklist – Edge" };

export default function ChecklistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
