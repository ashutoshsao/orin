// What a deployed app's link is called. One Vercel project per Orin project, and its name is
// the link people see: https://<slug>-<4 id chars>.vercel.app. The id suffix keeps two
// "Todo app"s apart; the slug is chosen once, at the first deploy, and stored — so a redeploy
// keeps the link, and nothing renamed later can move one that's been shared.

// Keeps the whole name well inside a DNS label (63). Vercel allows lowercase letters, digits
// and single dashes.
export const SLUG_MAX = 40;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// "Café Menü — v2" → "cafe-menu-v2"; "" when nothing usable is left.
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
}

// A slug someone typed is taken as-is or refused — never silently rewritten into a link they
// didn't see. (The page slugifies as they type, so a refusal means a hand-made request.)
export const isValidSlug = (s: string) => s.length <= SLUG_MAX && SLUG.test(s);

export const idSuffix = (projectId: string) => projectId.replace(/-/g, "").slice(0, 4);
export const vercelProjectName = (projectId: string, slug: string) => `${slug || "app"}-${idSuffix(projectId)}`;

// The example shown as the publish dialog's placeholder — a hint, never used unless typed.
// Project names are the first prompt cut at 60 characters ("can you build me a landing page
// for my c…"), so they make bad examples. The app's own <title> is usually its real name — the
// agent sets one — and costs nothing to read. It's model-written, so it's untrusted: slugify()
// reduces it to [a-z0-9-] before anything uses it.
export function suggestSlug(indexHtml: string | null, projectName: string): string {
  return slugify(appTitle(indexHtml) ?? "") || slugify(keyWords(projectName)) || "coffee-shop";
}

const DEFAULT_TITLES = new Set(["react-template", "vite + react + ts", "vite + react"]);

// "Verdant — Plant care, simplified" → "Verdant". Null when there's no title, or it's still the
// template's own.
export function appTitle(indexHtml: string | null): string | null {
  const raw = indexHtml?.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  const title = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!title || DEFAULT_TITLES.has(title.toLowerCase())) return null;
  return title.split(/\s[-–—|·:]\s|[–—|·]/)[0]!.trim() || null;
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: "—", ndash: "–", middot: "·", nbsp: " " };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, k: string) => named[k.toLowerCase()] ?? m);
}

// Fallback when the app has no title: the first few words of the prompt that say what it is.
// "can you build me a landing page for my coffee shop" → "landing page coffee".
const FILLER = new Set([
  "a", "an", "the", "i", "me", "my", "we", "our", "you", "your", "it", "this", "that",
  "can", "could", "would", "will", "please", "pls", "want", "need", "like", "lets", "let",
  "build", "make", "create", "generate", "design", "develop", "write", "do", "give",
  "for", "with", "and", "of", "to", "in", "on", "that", "which", "some", "simple", "new", "app",
]);
function keyWords(text: string): string {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)).slice(0, 3).join(" ");
}
