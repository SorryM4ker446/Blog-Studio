import { apiRequest, publicApiRequest } from "./api-client";

export const linkIcons = ["star", "grid", "layout", "zap", "link", "code", "book", "globe"] as const;
export const linkColors = ["blue", "yellow", "green", "red"] as const;
export type LinkColor = typeof linkColors[number] | `#${string}`;
export const isCustomLinkColor = (color: string): color is `#${string}` => /^#[0-9a-f]{6}$/i.test(color);
export interface LinkFields {
  title: string; description: string; url: string;
  icon: typeof linkIcons[number]; color: LinkColor; visible: boolean;
}
export interface HomepageLink extends LinkFields { id: number; position: number; version: number }
export function validateLink(fields: LinkFields) {
  let urlError = "";
  const url = fields.url.trim();
  if (!url && fields.visible) urlError = "Enter a URL before showing this link on the homepage.";
  if (url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:\/\//i.test(url) || !["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || /[\s\\]/.test(url) || new TextEncoder().encode(url).length > 2048) throw new Error();
    } catch { urlError = "Enter a complete http:// or https:// URL."; }
  }
  return { title: !fields.title.trim() ? "Enter a link title." : fields.title.trim().length > 100 ? "Use up to 100 characters." : "",
    description: fields.description.trim().length > 300 ? "Use up to 300 characters." : "", url: urlError };
}
export const getHomepageLinks = (signal?: AbortSignal) => publicApiRequest<HomepageLink[]>("/links", { signal });
export const getAdminLinks = (signal?: AbortSignal) => apiRequest<HomepageLink[]>("/admin/links", { auth: true, signal });
function mutate<T>(path: string, method: string, data: unknown) {
  return apiRequest<T>(path, { method, auth: true, csrf: true, handleSessionExpiry: false,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
export const createLink = (fields: LinkFields, requestID: string) => mutate<HomepageLink>("/admin/links", "POST", { ...fields, request_id: requestID });
export const updateLink = (link: HomepageLink, fields: LinkFields) => mutate<HomepageLink>(`/admin/links/${link.id}`, "PUT", { ...fields, version: link.version });
export const deleteLink = (link: HomepageLink) => mutate<void>(`/admin/links/${link.id}`, "DELETE", { version: link.version });
export const moveLink = (link: HomepageLink, neighbor: HomepageLink) => mutate<HomepageLink[]>(`/admin/links/${link.id}/move`, "POST", { version: link.version, neighbor_id: neighbor.id, neighbor_version: neighbor.version });
