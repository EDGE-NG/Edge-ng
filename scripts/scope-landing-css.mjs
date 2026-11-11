/**
 * One-off: prefix the original homepage CSS with `.landing-page` so its
 * global selectors (body, h2, section, nav, footer...) don't leak into
 * the app routes. `html` rules stay global; @keyframes stay verbatim.
 * Run: node scripts/scope-landing-css.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = fs.readFileSync(path.join(root, "content", "homepage.html"), "utf8");
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
    // find matching close brace
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
      out += prelude + "{" + body + "}"; // @font-face etc.
    } else {
      out += prefixSelector(prelude) + "{" + body + "}";
    }
    i = j;
  }
  return out;
}

const scoped = processRules(css);
fs.writeFileSync(path.join(root, "app", "homepage.css"), scoped);
console.log("Wrote app/homepage.css:", scoped.length, "bytes");
