import { MAX_EVIDENCE_IMAGES, MIN_EVIDENCE_IMAGES } from "@edge/shared";
import { Placeholder } from "@/components/Placeholder";

export default function EvidencePage() {
  return (
    <Placeholder
      title="Evidence library"
      summary={`Each rule takes ${MIN_EVIDENCE_IMAGES} to ${MAX_EVIDENCE_IMAGES} chart images, marked valid or invalid, with an optional note. Edge explains how it reads each image and the trader confirms. A coverage indicator encourages variety.`}
      prd={["4.3 PR-EV-1 to PR-EV-6", "5.3", "Flow F4"]}
      owners="Mayokun and Daniel (frontend), Helen (design), Daniel (AI), Sheyi (backend)"
    />
  );
}
