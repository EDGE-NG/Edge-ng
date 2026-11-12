import type { Metadata } from "next";
import AuthScreen from "../_components/auth-screen";

export const metadata: Metadata = { title: "Sign in – Edge" };

export default function LoginPage() {
  return <AuthScreen mode="signin" />;
}
