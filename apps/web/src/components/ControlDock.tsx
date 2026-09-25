import { useState } from "react";
import { BrutalButton } from "./BrutalButton";

const REPORT_REASONS = [
  { value: "nudity_sexual_content", label: "Nudity / sexual content" },
  { value: "minor_suspected", label: "I think this is a minor" },
  { value: "harassment", label: "Harassment" },
  { value: "violence_threats", label: "Violence / threats" },
  { value: "spam", label: "Spam" },
  { value: "csam_suspected", label: "Child exploitation" },
  { value: "other", label: "Other" },
] as const;

export function ControlDock({
  onSkip,
  onReport,
  onBlock,
  micMuted,
  camOff,
  onToggleMic,
  onToggleCam,
  soundMuted,
  onToggleSound,
}: {
  onSkip: () => void;
  onReport: (reason: string, details?: string) => void;
  onBlock: () => void;
  micMuted?: boolean;
  camOff?: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
  soundMuted?: boolean;
  onToggleSound?: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");

  const submitReport = () => {
    if (!selectedReason) return;
    onReport(selectedReason, details.trim() || undefined);
    setReportOpen(false);
    setSelectedReason(null);
    setDetails("");
  };

  return (
    <div className="relative flex flex-wrap items-center justify-center gap-3 p-4 bg-charcoal border-t-2 border-black">
      {onToggleMic && (
        <BrutalButton variant={micMuted ? "ghost" : "cyan"} onClick={onToggleMic} className="text-xs px-4 py-2">
          {micMuted ? "Mic Off" : "Mic On"}
        </BrutalButton>
      )}
      {onToggleCam && (
        <BrutalButton variant={camOff ? "ghost" : "cyan"} onClick={onToggleCam} className="text-xs px-4 py-2">
          {camOff ? "Cam Off" : "Cam On"}
        </BrutalButton>
      )}
      <BrutalButton variant="lime" onClick={onSkip}>
        Skip
      </BrutalButton>
      <BrutalButton variant="magenta" onClick={() => setReportOpen((v) => !v)}>
        Report
      </BrutalButton>
      <BrutalButton variant="ghost" className="border-red-500 text-red-400" onClick={onBlock}>
        Block
      </BrutalButton>
      {onToggleSound && (
        <BrutalButton variant="ghost" onClick={onToggleSound} className="text-xs px-4 py-2">
          {soundMuted ? "🔇" : "🔊"}
        </BrutalButton>
      )}

      {reportOpen && (
        <div className="absolute bottom-full mb-2 bg-black border-2 border-magenta shadow-brutal p-3 w-80">
          <p className="text-xs uppercase text-magenta mb-2">Why are you reporting?</p>
          <div className="flex flex-col gap-1 mb-2">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setSelectedReason(r.value)}
                className={`text-left text-sm px-2 py-1 ${
                  selectedReason === r.value ? "bg-magenta text-black" : "hover:bg-magenta/30"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Optional details..."
            maxLength={1000}
            className="w-full bg-charcoal border border-gray-600 text-xs p-2 mb-2 text-white outline-none focus:border-magenta"
            rows={2}
          />
          <BrutalButton variant="magenta" onClick={submitReport} disabled={!selectedReason} className="w-full text-xs py-2">
            Submit Report
          </BrutalButton>
        </div>
      )}
    </div>
  );
}
