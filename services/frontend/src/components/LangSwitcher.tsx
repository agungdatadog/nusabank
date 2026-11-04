import { useEffect, useRef, useState } from "react";
import { useT, type Lang } from "../i18n";

// Language names are shown in their own language, as on most bilingual banking sites.
const OPTIONS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "id", label: "Indonesia" },
];

export function LangSwitcher() {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="lang" ref={box}>
      <button type="button" className="lang-btn" aria-label={t("lang.label")} aria-expanded={open} onClick={() => setOpen(!open)}
        data-dd-action-name="language_menu">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M4 4h16v12H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        <span className="lang-code">{lang.toUpperCase()}</span>
      </button>
      {open && (
        <ul className="lang-menu card" role="menu">
          {OPTIONS.map((o) => (
            <li key={o.code}>
              <button type="button" role="menuitemradio" aria-checked={lang === o.code} data-dd-action-name={`language_${o.code}`}
                onClick={() => { setLang(o.code); setOpen(false); }}>
                <span>{o.label}</span>
                {lang === o.code && <span className="lang-check" aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
