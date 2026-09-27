"use client";
import { useEffect, useRef, useState } from "react";
import ModalSurface from "@/components/ModalSurface";
import { linkIcons, validateLink, type HomepageLink, type LinkFields } from "@/lib/links";
import LinkColorPicker from "./LinkColorPicker";
import { getApiErrorMessage } from "@/lib/api-client";
import { registerLeaveGuard } from "@/lib/editor-navigation";
import { LinkCardContent, LinkIcon } from "./LinkCard";
import styles from "./Links.module.css";

export default function LinkEditorDialog({ link, blockedReason = "", onSave, onClose }: { link: HomepageLink | null; blockedReason?: string; onSave: (fields: LinkFields, requestID: string) => Promise<void>; onClose: () => void }) {
  const [baseline] = useState<LinkFields>(() => link ? { title: link.title, description: link.description, url: link.url, icon: link.icon, color: link.color, visible: link.visible } : { title: "", description: "", url: "", icon: "link", color: "blue", visible: true });
  const [fields, setFields] = useState(baseline);
  const [requestID] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibilityPointerFocus, setVisibilityPointerFocus] = useState(false);
  const [error, setError] = useState("");
  const live = useRef({ saving: false });
  const errors = attempted ? validateLink(fields) : { title: "", description: "", url: "" };
  useEffect(() => registerLeaveGuard({ dirty: () => false, busy: () => live.current.saving, flush: async () => {}, expire: async () => {} }), []);
  function field<K extends keyof LinkFields>(key: K, value: LinkFields[K]) { setFields(current => ({ ...current, [key]: value })); }
  function textField(key: "title" | "description", value: string, max: number) {
    const previousLength = [...fields[key]].length;
    if (previousLength > max && [...value].length > max) {
      if ([...value].length < previousLength) field(key, value);
    } else field(key, [...value].slice(0, max).join(""));
  }
  async function save(close: () => void) {
    if (live.current.saving || blockedReason) return;
    setAttempted(true);
    const invalid = validateLink(fields);
    const first = (Object.keys(invalid) as (keyof typeof invalid)[]).find(key => invalid[key]);
    if (first) { document.getElementById(`link-${first}`)?.focus(); return; }
    live.current.saving = true; setSaving(true);
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
        {([ ["title", "TITLE", 25], ["description", "DESCRIPTION", 50], ["url", "DESTINATION URL", 2048] ] as const).map(([key, label, max]) => {
          const count = key === "url" ? null : [...fields[key]].length;
          const tooLong = count !== null && count > max;
          const feedback = errors[key] || (tooLong ? `Shorten the ${key} to ${max} characters before saving.` : "");
          const describedBy = [count !== null && `link-${key}-count`, feedback && `link-${key}-error`].filter(Boolean).join(" ") || undefined;
          return <div key={key} className={styles.field}>
            <div className={styles.fieldHeader}><label htmlFor={`link-${key}`}>{label}</label>{count !== null && <span id={`link-${key}-count`} className={`${styles.counter} ${tooLong ? styles.overLimit : ""}`}>{count}/{max}</span>}</div>
            {key === "description" ? <textarea id={`link-${key}`} value={fields[key]} onChange={e => textField(key, e.target.value, max)} aria-invalid={Boolean(feedback)} aria-describedby={describedBy} />
              : <input data-autofocus={key === "title" || undefined} id={`link-${key}`} type={key === "url" ? "url" : "text"} maxLength={key === "url" ? max : undefined} value={fields[key]} onChange={e => key === "url" ? field(key, e.target.value) : textField(key, e.target.value, max)} aria-invalid={Boolean(feedback)} aria-describedby={describedBy} autoComplete="off" />}
            {feedback && <p id={`link-${key}-error`} className={styles.error} role={attempted ? "alert" : undefined}>{feedback}</p>}
          </div>;
        })}
        <fieldset className={styles.choices}><legend className={styles.legend}>ICON</legend>{linkIcons.map(icon => <button type="button" key={icon} aria-label={`${icon} icon`} aria-pressed={fields.icon === icon} onClick={() => field("icon",icon)}><LinkIcon icon={icon} /></button>)}</fieldset>
        <LinkColorPicker value={fields.color} onChange={color => field("color", color)} />
        <label className={styles.visibility} data-pointer-focus={visibilityPointerFocus || undefined}
          onPointerDown={() => setVisibilityPointerFocus(true)} onKeyDown={() => setVisibilityPointerFocus(false)} onBlur={() => setVisibilityPointerFocus(false)}>
          <input type="checkbox" checked={fields.visible} onChange={e => field("visible",e.target.checked)} /> Show on homepage
        </label>
      </div><aside className={styles.preview}><p className={styles.legend}>LIVE PREVIEW</p><div className={styles.card}><LinkCardContent link={fields} /></div><p className={styles.hint} style={{ marginTop: 12 }}>{fields.visible ? "Visible after saving." : "Hidden from visitors. You can enable it later."}</p></aside></div>
      </fieldset>
      <div className={styles.saveFeedback}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {blockedReason && !saving && <p id="link-save-blocked" className={styles.hint} role="status">{blockedReason}</p>}
        {saving && <span className="sr-only" role="status">Saving link…</span>}
      </div>
      <div className={styles.footer}><button className={styles.button} type="button" disabled={saving || closing} onClick={close}>Cancel</button><button className={`${styles.button} ${styles.primary}`} type="submit" aria-describedby={blockedReason && !saving ? "link-save-blocked" : undefined} disabled={saving || closing || Boolean(blockedReason)}>Save link</button></div>
    </form>
    </>}
  </ModalSurface>;
}
