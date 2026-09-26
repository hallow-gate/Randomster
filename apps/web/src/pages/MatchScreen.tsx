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
import { LiveButton } from "../components/LiveButton";

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
  // Defaults to 16:9 (matches the `aspect-video` fallback class below) until
  // we know the stranger's actual camera shape.
  const [remoteAspectRatio, setRemoteAspectRatio] = useState(16 / 9);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    // A lot of webcams (laptops especially) actually capture 4:3, not the
    // 16:9 the constraints request as "ideal" -- getUserMedia falls back
    // silently when the camera doesn't support it. Forcing that into a
    // fixed 16:9 box and cropping to fill (`object-cover`) is exactly what
    // "too zoomed in" looks like: the top and bottom of the frame (which is
    // where headroom above the face lives) get cut off. Reading the real
    // dimensions off the incoming stream and matching the box to them means
    // there's nothing left to crop -- the box's shape *is* the video's
    // shape, so `object-cover` can't zoom in on anything.
    const updateAspectRatio = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setRemoteAspectRatio(video.videoWidth / video.videoHeight);
      }
    };
    updateAspectRatio();
    video.addEventListener("loadedmetadata", updateAspectRatio);
    video.addEventListener("resize", updateAspectRatio);
    return () => {
      video.removeEventListener("loadedmetadata", updateAspectRatio);
      video.removeEventListener("resize", updateAspectRatio);
    };
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
    // `h-dvh` (dynamic viewport height) instead of `min-h-screen`: on mobile
    // browsers the address bar/toolbar changes the *visible* viewport as you
    // scroll, and `100vh` measures the *maximum* one, so the page was
    // consistently a bit taller than the visible screen. Paired with
    // `overflow-hidden` here, the whole call UI is now sized to actually fit
    // the screen -- nothing to scroll past to reach the chat or controls.
    <div className="h-dvh flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-black">
        <h1 className="font-display font-bold text-lime">RANDOMSTER</h1>
        <div className="flex items-center gap-3">
          <LiveButton />
          <FlagBadge countryCode={profile.country_code} />
          <Link to={`/profile/${profile.username}`} className="font-mono text-xs text-gray-400 hover:text-lime">
            @{profile.username}
          </Link>
          <Link to="/settings" className="text-xs text-cyan underline">
            settings
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
        {/* Video + status + controls column. `min-h-0` matters here: without
            it, a flex child sizes to its content and ignores the parent's
            height limit, which is exactly how this column used to push the
            page taller than the viewport. */}
        <div className="flex flex-col gap-4 min-h-0 md:flex-1">
          {/*
            Fixed aspect ratio instead of `flex-1`: `flex-1` let this box
            stretch to fill whatever vertical space happened to be left over
            in the column, which on a PC window that's short-and-wide or
            tall-and-narrow could make the video area comically squat or
            stretched, and on a phone left an unpredictable amount of room
            for the controls and chat below it. `aspect-video` gives it a
            fixed, predictable shape at any screen size, and the `max-h-*`
            caps stop it from growing too tall on very narrow/tall phone
            screens, capping video to a fair share of the vertical space
            for the controls and chat that live under it in the same column.
          */}
          <div
            style={{ aspectRatio: remoteAspectRatio }}
            className={`relative w-full mx-auto aspect-video max-h-[42vh] md:max-h-[65vh] bg-black border-2 border-black shadow-brutal overflow-hidden ${
              scanlinesOn ? "scanlines" : ""
            }`}
          >
            {/* Mirrored to match the local self-preview below: both sides
                of a call now see every face (their own and the stranger's)
                mirrored, rather than the stranger's video appearing
                "flipped" relative to your own. */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover -scale-x-100"
            />

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
                className="absolute bottom-2 right-2 w-20 h-16 sm:bottom-3 sm:right-3 sm:w-28 sm:h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100"
              />
            )}
          </div>

          {mediaError && <p className="text-magenta text-xs shrink-0">Camera/mic error: {mediaError}</p>}

          {state === "idle" && (
            <div className="flex flex-col items-center gap-3 py-6 shrink-0">
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
            <div className="flex justify-center py-6 shrink-0">
              <TerminalLoader countryCode={profile.country_code} />
            </div>
          )}

          {state === "ended" && (
            <div className="flex flex-col items-center gap-3 py-6 shrink-0">
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

        {/* `min-h-0` + `flex-1` on mobile: the chat panel used to have a
            fixed `h-96` here, which -- stacked under a video box that also
            had no real height cap -- is what pushed the total page height
            past the viewport and forced the scroll the whole call UI now
            avoids. It now just takes whatever room is left in the column,
            and its own internal message list (already `overflow-y-auto`)
            scrolls exactly like a chat app's should. */}
        {state === "matched" && matchId && selfId && (
          <div className="flex-1 min-h-0 md:flex-none md:w-96 md:h-full">
            <ChatPanel key={matchId} matchId={matchId} selfId={selfId} />
          </div>
        )}
      </main>
    </div>
  );
}
