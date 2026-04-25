// Service worker deregistration script.
// next-pwa has been removed from this project.
// This script unregisters any cached service workers from previous builds
// so browsers do not serve stale cached routes.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister().then(() => self.clients.matchAll()).then((clients) => {
      clients.forEach((client) => {
        if (client.url && 'navigate' in client) {
          client.navigate(client.url)
        }
      })
    })
  )
})