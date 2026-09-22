"use client";
import { useEffect, useRef, useState } from "react";
import ModalSurface from "@/components/ModalSurface";
import { linkColors, linkIcons, validateLink, type HomepageLink, type LinkFields } from "@/lib/links";
import { getApiErrorMessage } from "@/lib/api-client";
import { registerLeaveGuard } from "@/lib/editor-navigation";
import { LinkCardContent, LinkIcon } from "./LinkCard";
import styles from "./Links.module.css";

export default function LinkEditorDialog({ link, onSave, onClose }: { link: HomepageLink | null; onSave: (fields: LinkFields, requestID: string) => Promise<void>; onClose: () => void }) {
  const [baseline] = useState<LinkFields>(() => link ? { title: link.title, description: link.description, url: link.url, icon: link.icon, color: link.color, visible: link.visible } : { title: "", description: "", url: "", icon: "link", color: "blue", visible: true });
  const [fields, setFields] = useState(baseline);
  const [requestID] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const live = useRef({ saving: false });
  const errors = attempted ? validateLink(fields) : { title: "", description: "", url: "" };
  useEffect(() => registerLeaveGuard({ dirty: () => false, busy: () => live.current.saving, flush: async () => {}, expire: async () => {} }), []);
  function field<K extends keyof LinkFields>(key: K, value: LinkFields[K]) { setFields(current => ({ ...current, [key]: value })); }
  async function save(close: () => void) {
    if (live.current.saving) return;
    setAttempted(true);
    const invalid = validateLink(fields);
    const first = (Object.keys(invalid) as (keyof typeof invalid)[]).find(key => invalid[key]);
    if (first) { document.getElementById(`link-${first}`)?.focus(); return; }
    live.current.saving = true; setSaving(true); setError("");
    try { await onSave({ ...fields, title: fields.title.trim(), description: fields.description.trim(), url: fields.url.trim() }, requestID); close(); }
    catch (err) { live.current.saving = false; setSaving(false); setError(getApiErrorMessage(err)); }
  }
  return <ModalSurface onClose={onClose} busy={saving} className={styles.dialog} labelledBy="link-dialog-title" describedBy="link-dialog-description">
    {(close, closing) => <>
    <div className={styles.dialogHeader}><h2 id="link-dialog-title">{link ? "Edit link" : "New link"}</h2><button type="button" className={styles.close} onClick={close} disabled={saving || closing} aria-label="Close dialog">×</button></div>
    <p id="link-dialog-description" className={styles.hint}>Give your homepage a useful shortcut. Links open in a new tab.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); if (!closing) void save(close); }} aria-busy={saving}>
      <fieldset disabled={saving || closing} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className={styles.form}><div className={styles.fields}>
        {([ ["title", "TITLE", 100], ["description", "DESCRIPTION", 300], ["url", "DESTINATION URL", 2048] ] as const).map(([key, label, max]) => <div key={key} className={styles.field}>
          <label htmlFor={`link-${key}`}>{label}</label>{key === "description" ? <textarea id={`link-${key}`} maxLength={max} value={fields[key]} onChange={e => field(key, e.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `link-${key}-error` : undefined} />
            : <input data-autofocus={key === "title" || undefined} id={`link-${key}`} type={key === "url" ? "url" : "text"} maxLength={max} value={fields[key]} onChange={e => field(key, e.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `link-${key}-error` : undefined} autoComplete="off" />}
          {errors[key] && <p id={`link-${key}-error`} className={styles.error} role="alert">{errors[key]}</p>}
        </div>)}
        <fieldset className={styles.choices}><legend className={styles.legend}>ICON</legend>{linkIcons.map(icon => <button type="button" key={icon} aria-label={`${icon} icon`} aria-pressed={fields.icon === icon} onClick={() => field("icon",icon)}><LinkIcon icon={icon} /></button>)}</fieldset>
        <fieldset className={styles.choices}><legend className={styles.legend}>COLOR</legend>{linkColors.map(color => <button type="button" key={color} aria-label={`${color} color`} aria-pressed={fields.color === color} onClick={() => field("color",color)}><span style={{ display: "block", width: 14, height: 14, borderRadius: "50%", background: `var(--accent-${color})` }} /></button>)}</fieldset>
        <label className={styles.visibility}><input type="checkbox" checked={fields.visible} onChange={e => field("visible",e.target.checked)} /> Show on homepage</label>
      </div><aside className={styles.preview}><p className={styles.legend}>LIVE PREVIEW</p><div className={styles.card}><LinkCardContent link={fields} /></div><p className={styles.hint} style={{ marginTop: 12 }}>{fields.visible ? "Visible after saving." : "Hidden from visitors. You can enable it later."}</p></aside></div>
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.footer}><button className={styles.button} type="button" disabled={saving || closing} onClick={close}>Cancel</button><button className={`${styles.button} ${styles.primary}`} type="submit" disabled={saving || closing}>{saving ? "Saving…" : "Save link"}</button></div>
    </form>
    </>}
  </ModalSurface>;
}
