"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  const applyTheme = (nextTheme: Theme) => {
    const isLight = nextTheme === "light";
    document.documentElement.classList.toggle("theme-light", isLight);
    document.body.classList.toggle("theme-light", isLight);
  };

  useEffect(() => {
    let nextTheme: Theme = "dark";

    // Check if SSR already applied theme class via cookie
    const isLight = document.documentElement.classList.contains("theme-light");
    if (isLight) {
      nextTheme = "light";
    } else {
      // Component mounted, try to load theme from local storage
      const storedTheme = localStorage.getItem("blog_theme") as Theme;
      if (storedTheme === "light" || storedTheme === "dark") {
        nextTheme = storedTheme;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        nextTheme = "light";
      }
    }

    applyTheme(nextTheme);
    const frame = window.requestAnimationFrame(() => {
      setTheme(nextTheme);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("blog_theme", newTheme);
    document.cookie = `blog_theme=${newTheme}; path=/; max-age=31536000; samesite=lax`;
    applyTheme(newTheme);
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
