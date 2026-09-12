# Browser appearance preferences

Theme and sidebar preferences use cookies as their only persistent source. The server reads these values for the initial HTML and passes the same snapshot to the client. Hydration does not read old localStorage preferences or rewrite cookies. A user action updates the current page immediately and attempts to write its cookie without a server mutation or page reload.

| Cookie | Accepted values | Default |
| --- | --- | --- |
| `blog_theme` | `dark`, `light` | `dark` |
| `sidebar_collapsed` | `false`, `true` | `false` |
| `sidebar_posts_expanded` | `false`, `true` | `false` |
| `sidebar_categories_all` | `false`, `true` | `false` |

Values are case-sensitive. Missing or invalid values use the listed defaults, even when old localStorage contains a different preference. All four cookies use `Path=/`, `Max-Age=31536000` (one year), and `SameSite=Lax`, without a Domain attribute. These are JavaScript-writable appearance preferences, separate from the HttpOnly authentication cookie. Their scope and names remain compatible with existing installations.

Opening a selected category can still expand its navigation group for that route. Collapsing the sidebar hides the group while retaining its expanded preference. The existing sidebar animation, editor width rules and article-body sizing are unchanged.

Storage exceptions cannot interrupt appearance controls. If cookie writes are rejected or silently ignored, changes remain usable in the current page, but a reload uses whatever valid cookies the browser actually sends, or the defaults. No localStorage fallback is attempted. Other open tabs keep their current in-memory appearance until reloaded; no live cross-tab preference synchronization is promised.

Old `blog_theme` and `sidebar_collapsed` localStorage entries are left untouched and ignored. Authentication still attempts to remove obsolete `blog_token` and `blog_user` entries while containing storage errors. Unrelated storage is not cleared. Scroll restoration continues using sessionStorage, and [article recovery](editor.md#browser-recovery-copies) continues using IndexedDB with its own retention and logout rules. Appearance changes never clear recovery copies.

Deploy the rebuilt frontend and reload existing pages to activate this behavior. No backend change, migration, additional dependency, environment variable or deployment service is required. See [testing](testing.md#appearance-preferences) for the regression scope.

## Date display

The site displays dates as `YYYY/MM/DD` and timestamps as `YYYY/MM/DD HH:mm:ss` using 24-hour time in `Asia/Shanghai` (Beijing time, UTC+08:00 for current dates). The Gregorian calendar and Latin digits are explicit. The same formatter runs on the server and browser, independent of the operating system, browser locale or browser time zone. It is used by Home, article lists/details, search, file cards/previews, editor lists/forms and recovery choices.

This replaces machine-local formatting; it does not change stored timestamps, publication history, sorting, recovery expiry or API values. An instant near midnight can appear on a different calendar day than it would in a visitor's own time zone. API timestamps must carry `Z` or an explicit offset; missing, invalid or timezone-less values display `—`. Browser-local recovery timestamps remain epoch milliseconds and use the same display zone. No locale detection, post-mount date replacement or hydration-warning suppression is used.
