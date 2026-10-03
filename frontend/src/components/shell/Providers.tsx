"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, type Theme } from "@/context/ThemeContext";
import { SidebarProvider } from "@/context/SidebarContext";
import type { InitialAppShellState } from "@/lib/app-shell-state";
import EditorLeaveDialog from "@/components/editor/EditorLeaveDialog";

export function Providers({
  children,
  initialSidebarCollapsed = false,
  initialSidebarPostsExpanded = false,
  initialSidebarShowAllCategories = false,
  initialTheme = "dark",
  initialAppShellState,
}: {
  children: ReactNode;
  initialSidebarCollapsed?: boolean;
  initialSidebarPostsExpanded?: boolean;
  initialSidebarShowAllCategories?: boolean;
  initialTheme?: Theme;
  initialAppShellState?: InitialAppShellState;
}) {
  return <ThemeProvider initialTheme={initialTheme}>
    <AuthProvider initialState={initialAppShellState}>
      <SidebarProvider initialCollapsed={initialSidebarCollapsed} initialPostsExpanded={initialSidebarPostsExpanded}
        initialShowAllCategories={initialSidebarShowAllCategories}
        initialCategories={initialAppShellState?.categories} initialCategoriesResolved={initialAppShellState?.categoriesResolved}>
        {children}
        <EditorLeaveDialog />
      </SidebarProvider>
    </AuthProvider>
  </ThemeProvider>;
}
