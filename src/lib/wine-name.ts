/**
 * Display-name composition for catalog rows.
 *
 * Catalog names arrive as "Producer VINTAGE Cuvée (Region)" — so rendering the
 * raw name above a "Producer · Region" line repeats the producer and buries the
 * cuvée. On-demand rows are worse: some have a name that IS the region.
 *
 * Never truncates. Only removes text that is already shown elsewhere on the card.
 */

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripVintage(name: string): string {
  return name.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
}

export type WineNameParts = {
  name: string;
  producer?: string | null;
  region?: string | null;
  grape?: string | null;
};

/**
 * The cuvée as it should read on a card whose second line already carries
 * producer and region.
 */
export function displayWineName(b: WineNameParts): string {
  const original = (b.name ?? "").trim();
  let out = stripVintage(original);

  // Drop a trailing parenthetical that just restates the region.
  const region = norm(b.region);
  out = out.replace(/\s*\(([^()]*)\)\s*$/, (match, inner: string) => {
    const n = norm(inner);
    if (!region) return match;
    return n === region || region.includes(n) || n.includes(region) ? " " : match;
  }).trim();

  // Drop a leading producer prefix.
  const producer = norm(b.producer);
  if (producer) {
    const words = producer.split(" ");
    const candidate = norm(out).split(" ");
    let i = 0;
    while (i < words.length && candidate[i] === words[i]) i++;
    if (i === words.length && candidate.length > words.length) {
      // Re-slice the original casing by matching word count.
      const raw = out.split(/\s+/);
      let consumed = 0;
      let cut = 0;
      for (const token of raw) {
        const n = norm(token);
        if (!n) { cut++; continue; }
        consumed += n.split(" ").length;
        cut++;
        if (consumed >= words.length) break;
      }
      out = raw.slice(cut).join(" ").trim();
    }
  }

  out = out.replace(/^[\s,·-]+|[\s,·-]+$/g, "").trim();

  // Nothing meaningful left, or the name was only ever the region.
  if (!out || (region && norm(out) === region)) {
    return (b.grape ?? "").trim() || (b.producer ?? "").trim() || original;
  }
  return out;
}

/** Second line — producer · region, without repeating whatever the title became. */
export function wineNameMeta(b: WineNameParts, title: string): string {
  const t = norm(title);
  return [b.producer, b.region]
    .filter((v): v is string => !!v && !!v.trim())
    .filter((v) => norm(v) !== t)
    .join(" · ");
}

/**
 * STORED-name composition for rows we create ourselves (on-demand resolve,
 * user-added bottle).
 *
 * Many classic labels carry no cuvée at all — the front label is producer +
 * appellation. Earlier call sites papered over that by storing the REGION as
 * bottles.name ("Rutherford, Napa Valley", "Meursault, Bourgogne"). That is
 * not a display bug: identity dedup matches on producer + name tokens, so a
 * region-named row shares its whole name token set with every other wine from
 * that appellation and mis-dedups against all of them.
 *
 * Rule: a name that is blank, or that is the region (either direction of
 * containment), is treated as "no cuvée" and replaced with producer + grape —
 * tokens that identify the wine rather than the place.
 */
export function composeBottleName(parts: {
  producer: string;
  cuvee?: string | null;
  region?: string | null;
  grape?: string | null;
}): string {
  const producer = (parts.producer ?? "").trim();
  const cuvee = (parts.cuvee ?? "").trim();
  const region = norm(parts.region);
  const c = norm(cuvee);

  const isRegionName =
    !!c && !!region && (c === region || region.includes(c) || c.includes(region));

  if (cuvee && !isRegionName) return cuvee;

  const grape = (parts.grape ?? "").trim();
  return [producer, grape].filter(Boolean).join(" ").trim() || producer;
}
