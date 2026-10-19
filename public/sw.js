/* Gicco chat service worker: shows Web Push notifications and opens the right screen on click.
   Plain JS on purpose (no build step). It does NOT cache pages, so it can never serve stale app code. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only same-origin paths are allowed, so a payload can never send someone to another site. */
function safeUrl(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Gicco chat";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    // Same tag = the newer notification REPLACES the older one (no lock-screen flood),
    // and `renotify` still alerts the person about it.
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: safeUrl(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        // reuse an open tab of the app: focus it and move it to the link
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* focus is enough if navigation is refused */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
