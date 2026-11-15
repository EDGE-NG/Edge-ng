import type { Metadata } from "next";
import DashboardView from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard – Edge" };

export default function Page() {
  return <DashboardView />;
}
