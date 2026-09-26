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
  onNext,
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
  onNext: () => void;
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
    // `shrink-0`: this dock sits at the bottom of a flex column that's now
    // height-constrained to the viewport (see MatchScreen) -- without it,
    // a flex item can shrink below its content size and get its buttons
    // squashed/overlapped instead of the column giving it the room it
    // needs.
    <div className="relative shrink-0 flex flex-col gap-2 p-3 sm:p-4 bg-charcoal border-t-2 border-black">
      {/* Toggle row: mic/cam/sound are secondary, frequently-tapped
          controls. `flex-1` on each makes them share the row evenly on a
          narrow phone instead of wrapping into a ragged second line. */}
      {(onToggleMic || onToggleCam || onToggleSound) && (
        <div className="flex items-center justify-center gap-2">
          {onToggleMic && (
            <BrutalButton
              variant={micMuted ? "ghost" : "cyan"}
              onClick={onToggleMic}
              className="flex-1 sm:flex-none text-xs px-3 py-2 sm:px-4"
            >
              {micMuted ? "Mic Off" : "Mic On"}
            </BrutalButton>
          )}
          {onToggleCam && (
            <BrutalButton
              variant={camOff ? "ghost" : "cyan"}
              onClick={onToggleCam}
              className="flex-1 sm:flex-none text-xs px-3 py-2 sm:px-4"
            >
              {camOff ? "Cam Off" : "Cam On"}
            </BrutalButton>
          )}
          {onToggleSound && (
            <BrutalButton
              variant="ghost"
              onClick={onToggleSound}
              className="flex-1 sm:flex-none text-xs px-3 py-2 sm:px-4"
            >
              {soundMuted ? "🔇 Sound" : "🔊 Sound"}
            </BrutalButton>
          )}
        </div>
      )}

      {/* Primary actions: a 2x2 grid keeps all four buttons the same size
          and evenly aligned on a narrow phone (the old `flex-wrap` let
          "Skip"/"Next"/"Report"/"Block" -- all different widths -- wrap
          into an uneven, off-center last row). From `sm` up there's room
          for one tidy line. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-center">
        <BrutalButton variant="lime" onClick={onSkip} className="text-sm py-2 sm:text-base sm:py-3">
          Skip
        </BrutalButton>
        <BrutalButton variant="cyan" onClick={onNext} className="text-sm py-2 sm:text-base sm:py-3">
          Next
        </BrutalButton>
        <BrutalButton
          variant="magenta"
          onClick={() => setReportOpen((v) => !v)}
          className="text-sm py-2 sm:text-base sm:py-3"
        >
          Report
        </BrutalButton>
        <BrutalButton
          variant="ghost"
          className="border-red-500 text-red-400 text-sm py-2 sm:text-base sm:py-3"
          onClick={onBlock}
        >
          Block
        </BrutalButton>
      </div>

      {reportOpen && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[calc(100vw-1.5rem)] max-w-sm bg-black border-2 border-magenta shadow-brutal p-3">
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
