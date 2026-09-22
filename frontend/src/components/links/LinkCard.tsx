import { StarIcon, GridIcon, LayoutIcon, ZapIcon } from "@/components/Icons";
import type { LinkFields } from "@/lib/links";
import styles from "./Links.module.css";

export function LinkIcon({ icon }: { icon: string }) {
  const known = { star: StarIcon, grid: GridIcon, layout: LayoutIcon, zap: ZapIcon };
  const Icon = known[icon as keyof typeof known];
  if (Icon) return <Icon size={18} />;
  const paths: Record<string, string> = {
    link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
    code: "m8 5-7 7 7 7m8-14 7 7-7 7m-3-17-2 20",
    book: "M12 5C8 2 4 2 2 3v16c4-1 7 0 10 2m0-16c4-3 8-3 10-2v16c-4-1-7 0-10 2V5",
    globe: "M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {icon === "globe" && <circle cx="12" cy="12" r="9" />}<path d={paths[icon] ?? paths.link} />
  </svg>;
}
export function LinkCardContent({ link }: { link: LinkFields }) {
  return <><div className={styles.cardHeading}><span className={styles.icon} data-color={link.color} aria-hidden="true"><LinkIcon icon={link.icon} /></span>
    <span>{link.title || "Your link title"}</span></div>
    <p className={styles.description}>{link.description || ""}</p></>;
}
export default function LinkCard({ link }: { link: LinkFields }) {
  return <a draggable={false} className={styles.card} href={link.url} target="_blank" rel="noopener noreferrer">
    <LinkCardContent link={link} /><span className="sr-only"> (opens in a new tab)</span>
  </a>;
}
