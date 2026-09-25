import { useEffect, useState } from "react";

interface Props {
  countryCode: string;
  onlineCount?: number;
}

export function TerminalLoader({ countryCode, onlineCount }: Props) {
  const lines = [
    `SCANNING...`,
    `COUNTRY: ${countryCode}`,
    onlineCount != null ? `${onlineCount} USERS ONLINE` : `CHECKING NETWORK...`,
    `SEARCHING FOR PARTNER...`,
  ];
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    setVisible([]);
    let i = 0;
    const interval = setInterval(() => {
      setVisible((prev) => (i < lines.length ? [...prev, lines[i]] : prev));
      i += 1;
      if (i >= lines.length) clearInterval(interval);
    }, 450);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryCode, onlineCount]);

  return (
    <div className="bg-black border-2 border-lime shadow-brutal p-4 font-mono text-lime text-sm w-full max-w-md">
      {visible.map((line, idx) => (
        <div key={idx}>&gt; {line}</div>
      ))}
      <div className="animate-pulse">&gt; _</div>
    </div>
  );
}
