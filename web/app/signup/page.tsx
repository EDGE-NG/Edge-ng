import type { Metadata } from "next";
import AuthScreen from "../_components/auth-screen";

export const metadata: Metadata = { title: "Create your account – Edge" };

export default function SignupPage() {
  return <AuthScreen mode="signup" />;
}
