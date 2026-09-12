"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { writePreference, type Theme } from "@/lib/preference-cookies";

export type { Theme } from "@/lib/preference-cookies";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({
  children,
  initialTheme = "dark",
}: {
  children: ReactNode;
  initialTheme?: Theme;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const applyTheme = (nextTheme: Theme) => {
    const isLight = nextTheme === "light";
    document.documentElement.classList.toggle("theme-light", isLight);
    document.body.classList.toggle("theme-light", isLight);
  };

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    applyTheme(newTheme);
    writePreference("blog_theme", newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
