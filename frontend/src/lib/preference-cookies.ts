const values = {
  blog_theme: ["dark", "light"],
  sidebar_collapsed: ["false", "true"],
  sidebar_posts_expanded: ["false", "true"],
  sidebar_categories_all: ["false", "true"],
} as const;

export type PreferenceName = keyof typeof values;
export type PreferenceValue<K extends PreferenceName> = (typeof values)[K][number];
export type Theme = PreferenceValue<"blog_theme">;

export function parsePreference<K extends PreferenceName>(name: K, value: unknown): PreferenceValue<K> {
  return (values[name] as readonly unknown[]).includes(value)
    ? value as PreferenceValue<K>
    : values[name][0];
}

export function readPreference<K extends PreferenceName>(
  cookies: { get(name: string): { value: string } | undefined },
  name: K,
): PreferenceValue<K> {
  return parsePreference(name, cookies.get(name)?.value);
}

export function writePreference<K extends PreferenceName>(name: K, value: PreferenceValue<K>): void {
  if (typeof document === "undefined" || !(values[name] as readonly unknown[]).includes(value)) return;
  try {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // The current page remains usable when browser policy denies persistence.
  }
}
