import type { Metadata } from "next";
import EvidenceLibrary from "./evidence-library";

export const metadata: Metadata = { title: "Evidence library – Edge" };

export default function Page() {
  return <EvidenceLibrary />;
}
