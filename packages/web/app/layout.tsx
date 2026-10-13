import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Providers } from "@/components/Providers"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" })

export const metadata: Metadata = {
  title: "Background Agents",
  description: "An AI coding agent chat interface",
  // PWA-ready metadata
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Background Agents",
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: "#1a1a2e",
  // Mobile viewport optimization
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Safe area support for notched devices
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(window.matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        {/* Prevent iOS text size adjustment */}
        <meta name="x-apple-disable-message-reformatting" />
        {/* Favicon: picks light/dark mask icon from OS preference before JS
            runs. <Favicon /> (in Providers) takes over after hydration so a
            manual in-app theme override is reflected too. */}
        <link rel="icon" type="image/svg+xml" href="/mask-icon-light.svg" media="(prefers-color-scheme: light)" />
        <link rel="icon" type="image/svg+xml" href="/mask-icon-dark.svg" media="(prefers-color-scheme: dark)" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased overflow-hidden`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
