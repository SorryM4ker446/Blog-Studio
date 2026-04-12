import "./globals.css";
import { Providers, SidebarContent, SidebarFooter } from "@/components/Providers";
import TopBar from "@/components/TopBar";

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
      <body>
        <Providers>
          <div className="app-container">
            {/* 左侧导航栏 */}
            <aside className="sidebar">
              <div className="sidebar-header">
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: "1.2rem",
                    letterSpacing: "-0.5px",
                  }}
                >
                  Blog Studio
                </span>
                <span style={{ marginLeft: "auto", opacity: 0.5 }}>◿</span>
              </div>

              <SidebarContent />
              <SidebarFooter />
            </aside>

          {/* 右侧核心面板 */}
          <main className="main-content">
            <TopBar />

            <div className="content-scroll">{children}</div>
          </main>
        </div>
        </Providers>
      </body>
    </html>
  );
}
