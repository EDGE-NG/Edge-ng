import { Placeholder } from "@/components/Placeholder";

export default function DashboardPage() {
  return (
    <Placeholder
      title="Dashboard"
      summary="Today, Week and Month views: plan adherence, performance, overrides against approved trades, and which rules fail most."
      prd={["4.7 PR-DB1 to PR-DB5", "Flow F9"]}
      owners="Mayokun and Daniel (frontend), Helen (design), Sheyi (backend)"
    />
  );
}
