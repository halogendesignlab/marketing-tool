import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ClientProvider } from "@/lib/client-context";
import { Toaster } from "react-hot-toast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Halogen Marketing Portal",
  description: "Content approval and performance reporting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <AuthProvider>
          <ClientProvider>
            {children}
            <Toaster
              position="bottom-left"
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
