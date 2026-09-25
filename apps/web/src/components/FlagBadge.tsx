function countryCodeToFlagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export function FlagBadge({ countryCode }: { countryCode: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 bg-charcoal border-2 border-lime px-2 py-1 shadow-brutal-sm font-mono text-xs uppercase"
      style={{ imageRendering: "pixelated" }}
    >
      <span className="text-base leading-none">{countryCodeToFlagEmoji(countryCode)}</span>
      <span className="text-lime">{countryCode}</span>
    </span>
  );
}
