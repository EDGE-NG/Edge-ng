"use client";

import { useEffect } from "react";

/**
 * Homepage behaviour, ported from the <script> in content/homepage.html:
 * hero pointer parallax, the hero review-card loop
 * (edge -> reviewing -> decision -> journal), and the "how it works"
 * stacked cards + steps. Keep in sync when a new design is uploaded.
 */
export default function HomeScript() {
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion:reduce)").matches;
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];

    /* hero: pointer parallax */
    const hero = document.getElementById("hero");
    const onMove = (e: PointerEvent) => {
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      hero.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    };
    if (!still && hero) hero.addEventListener("pointermove", onMove);

    /* hero demo card: one loop (~7.6 s) = edge -> review -> decision -> journal */
    const rv = document.querySelector<HTMLElement>(".rv");
    if (rv) {
      const labels = ["Your edge", "Reviewing", "Your decision", "Journal"];
      const times = [1700, 2700, 1500, 1700];
      const lab = rv.querySelector(".rv-s");
      let ph = 0;
      const setPhase = (n: number) => {
        ph = n;
        rv.setAttribute("data-phase", String(n));
        if (lab) lab.textContent = labels[n];
      };
      const nextPhase = () => {
        setPhase((ph + 1) % 4);
        timeouts.push(setTimeout(nextPhase, times[ph]));
      };
      if (still) setPhase(1);
      else {
        setPhase(0);
        timeouts.push(setTimeout(nextPhase, times[0]));
      }
    }

    /* how it works: stacked cards + steps */
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".landing-page .card"));
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".landing-page .step"));
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
      if (!still) timer = setInterval(() => show((cur + 1) % steps.length), 3200);
    };
    const handlers = steps.map((s, i) => {
      const h = () => {
        show(i);
        start();
      };
      s.addEventListener("click", h);
      return h;
    });
    if (steps.length) {
      show(0);
      start();
    }

    return () => {
      if (timer) clearInterval(timer);
      timeouts.forEach(clearTimeout);
      if (hero) hero.removeEventListener("pointermove", onMove);
      steps.forEach((s, i) => s.removeEventListener("click", handlers[i]));
    };
  }, []);

  return null;
}
