/** GitHub-style heading slug: lowercase, punctuation removed, spaces become hyphens. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Produces unique slugs for a document, suffixing repeats with `-1`, `-2`, ... */
export class Slugger {
  private readonly seen = new Map<string, number>();

  slug(text: string): string {
    const base = slugify(text);
    let slug = base;
    let count = this.seen.get(base) ?? 0;
    while (this.seen.has(slug)) {
      count++;
      slug = `${base}-${count}`;
    }
    this.seen.set(base, count);
    this.seen.set(slug, 0);
    return slug;
  }
}
