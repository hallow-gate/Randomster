import { useEffect, useRef, useState } from "react";

export function useLocalMedia(active: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
      })
      .catch((err) => setError((err as Error).message));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [active]);

  const toggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
  };

  const toggleCam = () => {
    const next = !camOff;
    setCamOff(next);
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
  };

  return { stream, micMuted, camOff, toggleMic, toggleCam, error };
}
