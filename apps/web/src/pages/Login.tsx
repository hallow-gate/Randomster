import { useAuthContext } from "../hooks/AuthProvider";
import { BrutalButton } from "../components/BrutalButton";

export default function Login() {
  const { signInWithGoogle } = useAuthContext();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="font-display text-5xl font-bold text-lime">RANDOMSTER</h1>
      <p className="text-gray-400 max-w-sm">
        Random video chat, matched by country. 18+ only. Verified identity required.
      </p>
      <BrutalButton variant="magenta" onClick={() => signInWithGoogle()}>
        Continue with Google
      </BrutalButton>
      <p className="text-xs text-gray-600 max-w-xs">
        By continuing you agree this platform is for adults only and that video calls are moderated for illegal
        content.
      </p>
    </div>
  );
}
