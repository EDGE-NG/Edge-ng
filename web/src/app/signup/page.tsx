import { Placeholder } from "@/components/Placeholder";

export default function SignupPage() {
  return (
    <main className="p-6 md:p-10">
      <Placeholder
        title="Sign up"
        summary="Email and password (or single sign-on), email verification, then display name, timezone, preferred markets and the disclaimer, before landing in the opening chat. “Get early access” on the landing page should lead here."
        prd={["Flow F1", "4.8", "REQ-ID-1"]}
        owners="Mayokun (frontend), Helen (design), Sheyi (backend), Moses (disclaimer text)"
      />
    </main>
  );
}
