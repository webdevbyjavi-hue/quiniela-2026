import { Oswald } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-oswald',
  display: 'swap',
})

export const metadata = {
  title: 'Quiniela 2026',
  description: 'Pronósticos Copa Mundial de Fútbol 2026',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es-MX" className={oswald.variable}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
