import { useEffect, useRef } from "react";

export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const ringPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let raf: number;
    const move = (e: MouseEvent) => {
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 3}px)`;
      }
      const dx = e.clientX - ringPos.current.x;
      const dy = e.clientY - ringPos.current.y;
      ringPos.current.x += dx * 0.2;
      ringPos.current.y += dy * 0.2;
    };

    const tick = () => {
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ringPos.current.x - 12}px, ${ringPos.current.y - 12}px)`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", move);
    raf = requestAnimationFrame(tick);
    document.body.classList.add("custom-cursor-zone");

    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(raf);
      document.body.classList.remove("custom-cursor-zone");
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="fixed top-0 left-0 w-1.5 h-1.5 bg-lime rounded-full pointer-events-none z-[100]" />
      <div
        ref={ringRef}
        className="fixed top-0 left-0 w-6 h-6 border-2 border-lime rounded-full pointer-events-none z-[100]"
      />
    </>
  );
}
