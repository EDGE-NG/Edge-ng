import { Placeholder } from "@/components/Placeholder";

export default function ChatPage() {
  return (
    <Placeholder
      title="Chat"
      summary="A new, empty chat with a purpose banner: “Tell Edge your trading plan. Type it or speak it. Edge turns it into a checklist you approve.” Edge replies with the extracted rules and asks about vague terms."
      prd={["4.1 PR-CH-1 to PR-CH-6", "5.2", "Flow F2"]}
      owners="Mayokun and Daniel (frontend), Helen (design), Daniel (AI), Sheyi (backend)"
    />
  );
}
