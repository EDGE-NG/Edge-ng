import type { Metadata } from "next";
import ComingNext from "../../_components/coming-next";

export const metadata: Metadata = { title: "Journal – Edge" };

export default function Page() {
  return <ComingNext section="journal" />;
}
