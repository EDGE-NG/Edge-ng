/**
 * The browsers' own push services (Chrome/Edge/Android, Firefox, Safari/iOS,
 * Windows). The server posts to the stored endpoint, so anything else is
 * refused: it never sends requests to an address a user made up.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export function allowedEndpoint(u: string): boolean {
  if (u.length > 1000) return false;
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      (PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s)))
    );
  } catch {
    return false;
  }
}
