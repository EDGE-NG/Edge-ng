/**
 * Build the landing page from the design source `content/homepage.html`.
 *
 *   node scripts/build-homepage.mjs      (or: npm run homepage)
 *
 * Re-run this whenever a new homepage design is uploaded. It writes:
 *   app/homepage.css        the design's CSS, scoped under `.landing-page` so
 *                           its global selectors (body, h2, section, nav...)
 *                           don't leak into the app. `html`/`:root` stay global,
 *                           @keyframes stay verbatim.
 *   app/homepage.body.html  the design's <body> markup without its <script>
 *                           (the behaviour lives in app/home-script.tsx), with
 *                           the call-to-action links wired to /signup and /login.
 *
 * Every link rewrite must match exactly once; if a new design changes the
 * markup the build fails loudly instead of silently shipping dead buttons.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
// normalise Windows line endings so the exact-match rewrites below are stable
const src = fs.readFileSync(path.join(root, "content", "homepage.html"), "utf8").replace(/\r\n/g, "\n");

/* ---------------------------------------------------------------- CSS --- */

const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];

function prefixSelector(sel) {
  return sel
    .split(",")
    .map((s) => {
      s = s.trim();
      if (!s) return s;
      if (s === ":root") return s;
      if (s === "html") return s; // scroll-behavior stays global
      if (s === "body") return ".landing-page";
      if (s.startsWith("html ") || s.startsWith("body "))
        return ".landing-page " + s.replace(/^(html|body)\s+/, "");
      return ".landing-page " + s;
    })
    .join(", ");
}

function processRules(cssText) {
  let out = "";
  let i = 0;
  while (i < cssText.length) {
    const brace = cssText.indexOf("{", i);
    if (brace === -1) {
      out += cssText.slice(i);
      break;
    }
    const prelude = cssText.slice(i, brace);
    let depth = 1;
    let j = brace + 1;
    while (j < cssText.length && depth > 0) {
      if (cssText[j] === "{") depth++;
      else if (cssText[j] === "}") depth--;
      j++;
    }
    const body = cssText.slice(brace + 1, j - 1);

    if (/^\s*@keyframes/.test(prelude)) {
      out += prelude + "{" + body + "}";
    } else if (/^\s*@media/.test(prelude)) {
      out += prelude + "{" + processRules(body) + "}";
    } else if (prelude.trim().startsWith("@")) {
      out += prelude + "{" + body + "}";
    } else {
      out += prefixSelector(prelude) + "{" + body + "}";
    }
    i = j;
  }
  return out;
}

/** Additions the app needs on top of the design (kept minimal and on-brand). */
const EXTRA_CSS = `
/* --- app additions (scripts/build-homepage.mjs) --- */
/* the marquee references a 'tick' animation the design never defines */
@keyframes tick{to{transform:translateX(-50%)}}
/* header: Sign in + Get started */
.landing-page .hdr-cta{display:flex;align-items:center;gap:8px}
.landing-page .btn-ghost{min-height:40px;padding:0 18px;font-size:.95rem;border-color:transparent;color:var(--muted)}
.landing-page .btn-ghost:hover{color:var(--text);background:rgba(255,255,255,.06)}
@media (max-width:540px){.landing-page .btn-ghost{padding:0 12px}}
/* the app's global .card adds an accent hairline; the landing cards have none */
.landing-page .card::before{display:none}
`;

const scoped = processRules(css) + EXTRA_CSS;
fs.writeFileSync(path.join(root, "app", "homepage.css"), scoped);

/* --------------------------------------------------------------- BODY --- */

let body = src.match(/<body>([\s\S]*?)<\/body>/)[1];
body = body.replace(/<script>[\s\S]*?<\/script>/g, "").trim() + "\n";

/** Replace `from` with `to`, requiring exactly `count` matches. */
function rewrite(label, from, to, count = 1) {
  const n = body.split(from).length - 1;
  if (n !== count) {
    throw new Error(
      `[build-homepage] "${label}": expected ${count} match(es), found ${n}. ` +
        `The homepage design changed; update the rewrite in scripts/build-homepage.mjs.`
    );
  }
  body = body.split(from).join(to);
}

// Header CTA -> Sign in + Get started
rewrite(
  "header CTA",
  `<a class="btn btn-main" href="#start">Get early access</a>\n  </div>\n</header>`,
  `<div class="hdr-cta"><a class="btn btn-ghost" href="/login">Sign in</a><a class="btn btn-main" href="/signup">Get started</a></div>\n  </div>\n</header>`
);
// Hero CTA -> sign up
rewrite(
  "hero CTA",
  `<a class="btn btn-main" href="#start">Get early access</a>`,
  `<a class="btn btn-main" href="/signup">Get started</a>`
);
// Finale -> sign up
rewrite(
  "finale sub",
  `<p class="sub">Join the early access list and be first to try Edge.</p>`,
  `<p class="sub">Create your account and turn your plan into a checklist in a few minutes.</p>`
);
rewrite(
  "finale CTA",
  `<a class="btn btn-main" href="mailto:hello@example.com?subject=Early%20access">Get early access</a>`,
  `<a class="btn btn-main" href="/signup">Create your account</a>`
);
// Footer column
rewrite("footer heading", `<h5>Early access</h5>`, `<h5>Account</h5>`);
rewrite(
  "footer links",
  `<li><a href="#start">Join the list</a></li>`,
  `<li><a href="/signup">Create account</a></li><li><a href="/login">Sign in</a></li>`
);

fs.writeFileSync(path.join(root, "app", "homepage.body.html"), body);

console.log(
  `Wrote app/homepage.css (${scoped.length} bytes) and app/homepage.body.html (${body.length} bytes)`
);
