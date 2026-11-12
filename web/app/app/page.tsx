import type { Metadata } from "next";
import ComingNext from "../_components/coming-next";

export const metadata: Metadata = { title: "Dashboard – Edge" };

export default function Page() {
  return <ComingNext section="dashboard" />;
}
