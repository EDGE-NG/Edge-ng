// Intentionally blocking: reads dynamic `params` and loads item data on the
// client. See app/app/edge/[id]/layout.tsx for details.
export const instant = false;

export default function VisualItemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
