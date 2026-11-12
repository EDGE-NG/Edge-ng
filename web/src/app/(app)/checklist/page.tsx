import { RULE_CATEGORIES } from "@edge/shared";
import { Placeholder } from "@/components/Placeholder";

export default function ChecklistPage() {
  return (
    <Placeholder
      title="Checklist"
      summary="The draft checklist from the chat. Rules are grouped by category and marked hard gate or soft. Approval is an explicit action; approved versions are locked and edits create a new draft."
      prd={["4.2 PR-CL-1 to PR-CL-5", "Flows F2, F3"]}
      owners="Mayokun and Daniel (frontend), Helen (design), Sheyi (backend)"
    >
      <p className="mt-6 text-sm text-muted">
        Rule categories (from @edge/shared): {RULE_CATEGORIES.join(", ")}
      </p>
    </Placeholder>
  );
}
