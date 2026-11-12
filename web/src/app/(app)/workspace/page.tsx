import { GATE_RESULT_LABELS, RULE_RESULT_LABELS } from "@edge/shared";
import { Placeholder } from "@/components/Placeholder";

export default function WorkspacePage() {
  return (
    <Placeholder
      title="Trade workspace"
      summary="Pick the asset and instrument, open Edge's chart with timeframe controls, and see the live checklist panel update rule by rule. Press Buy or Sell in the ticket to run the gate."
      prd={["4.4 PR-TW-1 to PR-TW-6", "4.5 PR-GT-1 to PR-GT-8", "5.4, 5.5", "Flows F5, F6, F7"]}
      owners="Daniel (leads) and Mayokun (frontend), Helen (design), Daniel (AI), Sheyi (backend)"
    >
      <div className="mt-6 grid gap-2 text-sm text-muted">
        <p>Rule states: {Object.values(RULE_RESULT_LABELS).join(" · ")}</p>
        <p>Gate outcomes: {Object.values(GATE_RESULT_LABELS).join(" · ")}</p>
      </div>
    </Placeholder>
  );
}
