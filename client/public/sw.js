self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Benachrichtigung", body: event.data.text() };
  }
  const title = payload.title || "Benachrichtigung";
  const options = {
    body: payload.body || "",
    data: payload.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ticketId = event.notification?.data?.ticketId;
  const url = ticketId ? `/tickets?ticketId=${ticketId}` : "/tickets";
  event.waitUntil(self.clients.openWindow(url));
});
