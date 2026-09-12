import "./globals.css";
import { Providers } from "@/components/Providers";
import ClientLayout from "@/components/ClientLayout";
import { cookies } from "next/headers";
import { loadInitialAppShellState } from "@/lib/server-app-shell";
import { readPreference } from "@/lib/preference-cookies";

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
  const isSidebarCollapsed = readPreference(cookieStore, "sidebar_collapsed") === "true";
  const areSidebarPostsExpanded = readPreference(cookieStore, "sidebar_posts_expanded") === "true";
  const areAllSidebarCategoriesShown = readPreference(cookieStore, "sidebar_categories_all") === "true";
  const isLightTheme = readPreference(cookieStore, "blog_theme") === "light";
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
