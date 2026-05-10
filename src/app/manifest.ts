import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'BZG Group Terminal',
    short_name:       'BZG Terminal',
    description:      'Système de gestion interne — Electro Zaki & Hamid Phone',
    start_url:        '/',
    display:          'standalone',
    background_color: '#FFFFFF',
    theme_color:      '#1A1A1A',
    orientation:      'landscape',
    icons: [
      {
        src:   '/icon-192.png',
        sizes: '192x192',
        type:  'image/png',
      },
      {
        src:   '/icon-512.png',
        sizes: '512x512',
        type:  'image/png',
      },
    ],
  }
}