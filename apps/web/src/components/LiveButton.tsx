import { Link } from "react-router-dom";

export function LiveButton() {
  return (
    <Link
      to="/live"
      className="inline-flex items-center gap-1.5 bg-magenta text-black font-display font-bold text-xs uppercase
        tracking-wide px-3 py-1.5 border-2 border-black shadow-brutal-sm transition-transform duration-100
        active:translate-x-[2px] active:translate-y-[2px] active:shadow-none hover:-translate-y-0.5"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-black" />
      </span>
      Live
    </Link>
  );
}
