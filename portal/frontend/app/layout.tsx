import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ClientProvider } from "@/lib/client-context";
import { Toaster } from "react-hot-toast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Halogen Marketing Portal",
  description: "Content approval and performance reporting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <AuthProvider>
          <ClientProvider>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: "#FFFFFF",
                  color: "#0E1014",
                  border: "1px solid #E4E7EC",
                  boxShadow: "0 12px 24px -6px rgba(16, 24, 40, 0.12)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: "14px",
                },
              }}
            />
          </ClientProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
