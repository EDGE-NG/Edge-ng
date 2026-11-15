import type { Metadata } from "next";
import SettingsView from "./settings-view";

export const metadata: Metadata = { title: "Settings – Edge" };

export default function Page() {
  return <SettingsView />;
}
