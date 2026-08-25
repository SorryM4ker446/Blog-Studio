import "./globals.css";
import { Providers } from "@/components/Providers";
import ClientLayout from "@/components/ClientLayout";
import { cookies } from "next/headers";
import { loadInitialAppShellState } from "@/lib/server-app-shell";

export const metadata = {
  title: "Blog Studio",
  description: "A functional, studio-inspired developer blog for sharing growth.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isSidebarCollapsed = cookieStore.get("sidebar_collapsed")?.value === "true";
  const areSidebarPostsExpanded = cookieStore.get("sidebar_posts_expanded")?.value === "true";
  const areAllSidebarCategoriesShown = cookieStore.get("sidebar_categories_all")?.value === "true";
  const isLightTheme = cookieStore.get("blog_theme")?.value === "light";
  const initialAppShellState = await loadInitialAppShellState(cookieStore.toString());

  return (
    <html
      lang="en"
      className={isLightTheme ? "theme-light" : undefined}
      data-sidebar-state={isSidebarCollapsed ? "collapsed" : undefined}
      suppressHydrationWarning
    >
      <body className={isLightTheme ? "theme-light" : undefined} suppressHydrationWarning>
        <Providers
          initialSidebarCollapsed={isSidebarCollapsed}
          initialSidebarPostsExpanded={areSidebarPostsExpanded}
          initialSidebarShowAllCategories={areAllSidebarCategoriesShown}
          initialTheme={isLightTheme ? "light" : "dark"}
          initialAppShellState={initialAppShellState}
        >
          <ClientLayout>{children}</ClientLayout>
        </Providers>
      </body>
    </html>
  );
}
