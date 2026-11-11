importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Fixed public configuration also works when the worker is loaded without a query string.
firebase.initializeApp({
  apiKey: "AIzaSyABfkU2uju6CBynfIPXTW8nEjF0uxWkzAc",
  authDomain: "puch-campu.firebaseapp.com",
  projectId: "puch-campu",
  storageBucket: "puch-campu.firebasestorage.app",
  messagingSenderId: "638482616533",
  appId: "1:638482616533:web:da3d7885046dbcf476925c",
});
const messaging = firebase.messaging();

// Single place that shows the OS notification (messages are data-only).
// Only fires when no app window is focused; the app shows a toast otherwise.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || "Campu";
  const path = data.path || "/";
  const options = {
    body: data.body || "",
    icon: new URL("/icon-192x192.png", self.location.origin).href,
    badge: new URL("/badge.png", self.location.origin).href,
    vibrate: [200, 100, 200, 100, 200],
    silent: false,
    renotify: true,
    requireInteraction: true,
    data: { path },
    tag: path,
  };
  if (data.image) options.image = data.image;
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/";
  const target = new URL(path, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
