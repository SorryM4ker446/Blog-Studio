import "./globals.css";
import { Providers } from "@/components/Providers";
import ClientLayout from "@/components/ClientLayout";
import Script from "next/script";

export const metadata = {
  title: "Blog Studio",
  description: "A functional, studio-inspired developer blog for sharing growth.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="theme-loader"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // 1. Theme loading logic
                  var theme = localStorage.getItem('blog_theme');
                  var supportDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches === true;
                  if (theme === 'light' || (!theme && !supportDarkMode)) {
                    document.documentElement.classList.add('theme-light');
                  }
                  // 2. Sidebar initial state logic (Fix FUS bug)
                  var sidebarCollapsed = localStorage.getItem('sidebar_collapsed');
                  if (sidebarCollapsed === 'true') {
                    document.documentElement.setAttribute('data-sidebar-state', 'collapsed');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>

        <Providers>
          <ClientLayout>{children}</ClientLayout>
        </Providers>
      </body>
    </html>
  );
}
