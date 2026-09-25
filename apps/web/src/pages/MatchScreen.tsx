import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { useMatchmaking } from "../hooks/useMatchmaking";
import { useLocalMedia } from "../hooks/useLocalMedia";
import { useCloudflareCalls } from "../hooks/useCloudflareCalls";
import { useSoundEffects } from "../hooks/useSoundEffects";
import { BrutalButton } from "../components/BrutalButton";
import { FlagBadge } from "../components/FlagBadge";
import { TerminalLoader } from "../components/TerminalLoader";
import { ChatPanel } from "../components/ChatPanel";
import { ControlDock } from "../components/ControlDock";

export default function MatchScreen() {
  const { session, profile } = useAuthContext();
  const selfId = session?.user.id;
  const { state, matchId, lastEndReason, join, skip, next, report, block, resetAfterEnd } = useMatchmaking(selfId);
  const [scanlinesOn, setScanlinesOn] = useState(true);
  const sound = useSoundEffects();

  const mediaActive = state === "matched";
  const { stream: localStream, micMuted, camOff, toggleMic, toggleCam, error: mediaError } = useLocalMedia(mediaActive);
  const { callState, remoteStream } = useCloudflareCalls(matchId, localStream);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (state === "matched") sound.play("connect");
    if (state === "ended") sound.play("disconnect");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!session || !profile) return null;

  const handleSkip = () => {
    sound.play("click");
    skip();
  };

  const handleNext = () => {
    sound.play("click");
    next(profile.match_scope);
  };

  const handleStart = () => {
    sound.play("click");
    join(profile.match_scope);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b-2 border-black">
        <h1 className="font-display font-bold text-lime">RANDOMSTER</h1>
        <div className="flex items-center gap-3">
          <FlagBadge countryCode={profile.country_code} />
          <span className="font-mono text-xs text-gray-400">@{profile.username}</span>
          <Link to="/settings" className="text-xs text-cyan underline">
            settings
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row gap-4 p-4">
        <div className="flex-1 flex flex-col gap-4">
          <div
            className={`relative flex-1 min-h-[240px] bg-black border-2 border-white shadow-brutal overflow-hidden ${
              scanlinesOn ? "scanlines" : ""
            }`}
          >
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />

            {state !== "matched" && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
                no stranger yet
              </div>
            )}
            {state === "matched" && callState === "connecting" && (
              <div className="absolute inset-0 flex items-center justify-center text-cyan text-sm font-mono bg-black/60">
                establishing connection...
              </div>
            )}
            {state === "matched" && callState === "failed" && (
              <div className="absolute inset-0 flex items-center justify-center text-magenta text-sm font-mono bg-black/60">
                connection failed — try skip
              </div>
            )}

            {localStream && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-3 right-3 w-28 h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100"
              />
            )}
          </div>

          {mediaError && <p className="text-magenta text-xs">Camera/mic error: {mediaError}</p>}

          {state === "idle" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <BrutalButton onClick={handleStart}>Start</BrutalButton>
              <button
                onClick={() => setScanlinesOn((v) => !v)}
                className="text-xs text-gray-500 underline underline-offset-2"
              >
                {scanlinesOn ? "disable" : "enable"} scanline effect
              </button>
            </div>
          )}

          {state === "queued" && (
            <div className="flex justify-center py-6">
              <TerminalLoader countryCode={profile.country_code} />
            </div>
          )}

          {state === "ended" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-xs text-gray-400 font-mono">
                {lastEndReason === "block"
                  ? "You were disconnected."
                  : lastEndReason === "report"
                  ? "That call was ended due to a report."
                  : lastEndReason === "moderation"
                  ? "That call was ended by automated moderation."
                  : "Stranger disconnected."}
              </p>
              <BrutalButton onClick={() => { resetAfterEnd(); handleStart(); }}>Find another</BrutalButton>
            </div>
          )}

          {state === "matched" && matchId && (
            <ControlDock
              onSkip={handleSkip}
              onNext={handleNext}
              onReport={(reason, details) => report(reason, details)}
              onBlock={block}
              micMuted={micMuted}
              camOff={camOff}
              onToggleMic={toggleMic}
              onToggleCam={toggleCam}
              soundMuted={sound.muted}
              onToggleSound={sound.toggleMuted}
            />
          )}
        </div>

        {state === "matched" && matchId && selfId && (
          <div className="w-full md:w-96 h-96 md:h-auto">
            <ChatPanel matchId={matchId} selfId={selfId} />
          </div>
        )}
      </main>
    </div>
  );
}
