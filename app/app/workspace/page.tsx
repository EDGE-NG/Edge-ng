import type { Metadata } from "next";
import Workspace from "./workspace";

export const metadata: Metadata = { title: "Trade workspace – Edge" };

export default function Page() {
  return <Workspace />;
}
