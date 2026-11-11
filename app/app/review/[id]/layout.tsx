// Intentionally blocking: reads dynamic `params` and loads review data on
// the client. See app/app/edge/[id]/layout.tsx for details.
export const instant = false;

export default function ReviewDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
