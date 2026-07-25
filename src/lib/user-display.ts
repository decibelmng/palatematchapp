// Central helpers for rendering a person's name in the UI.
//
// Rule: never surface raw auto-generated handles like `user_c808a310` as a
// person's visible name. Prefer the display name, then a graceful placeholder.
// The @handle is available on tap (see NameWithHandle) and via aria-label.

const AUTO_HANDLE_RE = /^user_[a-f0-9]{6,}$/i;

/** True for system-generated placeholder handles (e.g. user_c808a310). */
export function isAutoHandle(username: string | null | undefined): boolean {
  if (!username) return true;
  return AUTO_HANDLE_RE.test(username.trim());
}

/** Graceful fallback when a user has no display name set. */
export const NAME_PLACEHOLDER = "Wine friend";

/** Best visible name for a person — display name, or a chosen handle, or a placeholder. */
export function displayNameFor(
  p: { display_name?: string | null; username?: string | null } | null | undefined,
  placeholder: string = NAME_PLACEHOLDER,
): string {
  const dn = p?.display_name?.trim();
  if (dn) return dn;
  const un = p?.username?.trim();
  if (un && !isAutoHandle(un)) return un;
  return placeholder;
}

/** Returns the @handle only when it's a user-chosen handle worth surfacing. */
export function handleForDisplay(username: string | null | undefined): string | null {
  if (!username) return null;
  const u = username.trim();
  if (!u || isAutoHandle(u)) return null;
  return u;
}

/** Initials for avatar fallbacks — 1–2 letters, never the raw id. */
export function initialsFor(
  p: { display_name?: string | null; username?: string | null } | null | undefined,
): string {
  const dn = p?.display_name?.trim();
  if (dn) {
    const parts = dn.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    const out = (first + last).toUpperCase();
    if (out) return out.slice(0, 2);
  }
  const un = p?.username?.trim();
  if (un && !isAutoHandle(un)) return un.slice(0, 2).toUpperCase();
  return "WF"; // Wine Friend
}
