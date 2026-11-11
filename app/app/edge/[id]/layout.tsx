// This segment is intentionally blocking: the pages under it read dynamic
// `params` and load their data on the client, so they cannot produce an
// instant static shell. Opting out of `instant` validation (server-only
// export — client components cannot declare it) silences the prerender
// blocking error while keeping the rest of the app validating.
export const instant = false;

export default function EdgeDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
