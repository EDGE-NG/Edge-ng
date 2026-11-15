import type { Metadata } from "next";
import JournalView from "./journal-view";

export const metadata: Metadata = { title: "Journal – Edge" };

export default function Page() {
  return <JournalView />;
}
