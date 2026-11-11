"use client";

import { useEffect } from "react";

/**
 * Original homepage behavior: ticker chips, hero pointer parallax,
 * and the "how it works" stacked-card steps.
 */
export default function HomeScript() {
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion:reduce)").matches;

    /* ticker chips */
    const data: Array<[string, string, string]> = [
      ["EUR/USD", "Pass", "pass"],
      ["GBP/JPY", "Fail", "fail"],
      ["XAU/USD", "Pass", "pass"],
      ["NAS100", "Inconclusive", "maybe"],
      ["USD/CAD", "Pass", "pass"],
      ["US30", "Fail", "fail"],
      ["AUD/USD", "Pass", "pass"],
      ["BTC/USD", "Inconclusive", "maybe"],
    ];
    const row = document.getElementById("row");
    if (row) {
      let h = "";
      for (let r = 0; r < 4; r++)
        data.forEach((d) => {
          h +=
            '<span class="chip"><i></i><b>' +
            d[0] +
            '</b><em class="' +
            d[2] +
            '">' +
            d[1] +
            "</em></span>";
        });
      row.innerHTML = h;
    }

    /* hero: pointer parallax */
    const hero = document.getElementById("hero");
    const onMove = (e: PointerEvent) => {
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
      hero.style.setProperty("--my", ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
    };
    if (!still && hero) hero.addEventListener("pointermove", onMove);

    /* how it works: stacked cards + steps */
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".step"));
    let cur = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    const show = (n: number) => {
      cur = n;
      cards.forEach((c, i) => {
        const p = (i - n + cards.length) % cards.length;
        c.style.setProperty("--p", String(p));
        if (p > 2) c.setAttribute("data-hide", "");
        else c.removeAttribute("data-hide");
      });
      steps.forEach((s, i) => {
        s.setAttribute("aria-selected", String(i === n));
        s.classList.toggle("done", i < n);
      });
    };
    const start = () => {
      if (timer) clearInterval(timer);
      if (!still) timer = setInterval(() => show((cur + 1) % steps.length), 5000);
    };
    steps.forEach((s, i) =>
      s.addEventListener("click", () => {
        show(i);
        start();
      })
    );
    if (steps.length) {
      show(0);
      start();
    }

    return () => {
      if (timer) clearInterval(timer);
      if (hero) hero.removeEventListener("pointermove", onMove);
      steps.forEach((s) => s.replaceWith(s.cloneNode(true)));
      cards.forEach((c) => c.replaceWith(c.cloneNode(true)));
    };
  }, []);

  return null;
}
