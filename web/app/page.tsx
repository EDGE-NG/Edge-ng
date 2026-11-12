import fs from "node:fs";
import path from "node:path";
import "./homepage.css";
import HomeScript from "./home-script";

/**
 * Landing page — the original marketing homepage, preserved verbatim
 * (markup and CSS extracted from the initial static index.html).
 */
export default function HomePage() {
  const body = fs.readFileSync(path.join(process.cwd(), "app", "homepage.body.html"), "utf8");
  return (
    <>
      <div className="landing-page" dangerouslySetInnerHTML={{ __html: body }} />
      <HomeScript />
    </>
  );
}
