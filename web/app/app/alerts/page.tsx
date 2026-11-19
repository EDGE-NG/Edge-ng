import type { Metadata } from "next";
import AlertsView from "./alerts-view";

export const metadata: Metadata = { title: "Alerts – Edge" };

export default function Page() {
  return <AlertsView />;
}
