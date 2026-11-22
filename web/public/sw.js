/*
 * Edge service worker: shows checklist alerts as device notifications (Web
 * Push) and opens Edge when one is clicked. It caches nothing.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Edge", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/app/alerts" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/app/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
