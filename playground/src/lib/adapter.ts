import { memoryAdapter } from '@mattthehat/astro-cms/adapters/memory'

// Module-level singleton so rows survive across requests in the dev server.
// Restarting the process (or a dev-server module reload) reseeds the data.
export const adapter = memoryAdapter({
  gigs: [
    { id: 1, artist: 'Slowdive', venue: 'Roundhouse', city: 'London', date: new Date('2026-09-01T20:00:00'), price: 38.5, sold_out: 1, notes: 'Souvlaki 30th anniversary tour' },
    { id: 2, artist: 'Mogwai', venue: 'Barrowland Ballroom', city: 'Glasgow', date: new Date('2026-08-14T19:30:00'), price: 32, sold_out: 0, notes: null },
    { id: 3, artist: 'Ride', venue: 'O2 Ritz', city: 'Manchester', date: new Date('2026-07-22T19:00:00'), price: 29, sold_out: 0, notes: 'With special guests' },
    { id: 4, artist: 'Beach House', venue: 'Usher Hall', city: 'Edinburgh', date: new Date('2026-10-03T20:00:00'), price: 41, sold_out: 1, notes: null },
    { id: 5, artist: 'Spiritualized', venue: 'Albert Hall', city: 'Manchester', date: new Date('2026-11-19T19:30:00'), price: 36, sold_out: 0, notes: 'Ladies and Gentlemen in full' },
    { id: 6, artist: 'Low', venue: 'Union Chapel', city: 'London', date: new Date('2026-06-30T20:00:00'), price: 27.5, sold_out: 1, notes: null },
    { id: 7, artist: 'Godspeed You! Black Emperor', venue: 'SWG3', city: 'Glasgow', date: new Date('2026-09-27T19:00:00'), price: 33, sold_out: 0, notes: null },
    { id: 8, artist: 'Yo La Tengo', venue: 'EartH', city: 'London', date: new Date('2026-08-05T19:30:00'), price: 30, sold_out: 0, notes: 'Two-night residency' },
    { id: 9, artist: 'Stereolab', venue: 'Invisible Wind Factory', city: 'Liverpool', date: new Date('2026-10-17T19:30:00'), price: 28, sold_out: 0, notes: null },
    { id: 10, artist: 'Explosions in the Sky', venue: 'Troxy', city: 'London', date: new Date('2026-11-02T19:00:00'), price: 35, sold_out: 0, notes: null },
    { id: 11, artist: 'Slint', venue: 'The Fleece', city: 'Bristol', date: new Date('2026-07-29T20:00:00'), price: 26, sold_out: 1, notes: 'Spiderland anniversary' },
    { id: 12, artist: 'Cocteau Twins', venue: 'Royal Albert Hall', city: 'London', date: new Date('2026-12-05T20:00:00'), price: 55, sold_out: 1, notes: 'Reunion show' },
  ],
})
