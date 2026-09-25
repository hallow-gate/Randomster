import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen px-4 py-10 flex justify-center">
      <div className="w-full max-w-2xl space-y-4 text-sm text-gray-300 font-mono">
        <Link to="/" className="text-cyan text-xs underline">
          ← back
        </Link>
        <h1 className="font-display text-3xl font-bold text-lime mb-4">Privacy Policy</h1>

        <p className="text-xs text-gray-500">
          This is placeholder policy text for the Randomster scaffold — replace it with counsel-reviewed
          language before launch. It summarizes what the codebase actually does today, not a legal
          commitment.
        </p>

        <section>
          <h2 className="text-cyan font-bold mb-1">What we collect</h2>
          <p>
            Your Google account email (via OAuth), a chosen username, your country (auto-detected or
            manually set), and chat messages sent during an active match.
          </p>
        </section>

        <section>
          <h2 className="text-cyan font-bold mb-1">Video and audio</h2>
          <p>
            Video/audio calls are relayed peer-to-peer or through Cloudflare's Calls infrastructure and are
            never recorded or stored by Randomster. Live video may be scanned in real time by automated
            classifiers to detect child sexual abuse material and other illegal content; matches flagged
            this way are terminated immediately and may be reported to the National Center for Missing &
            Exploited Children (NCMEC) or law enforcement as legally required.
          </p>
        </section>

        <section>
          <h2 className="text-cyan font-bold mb-1">Chat messages</h2>
          <p>
            Message content is deleted automatically no later than one hour after a match ends. We do not
            retain a permanent archive of chat content.
          </p>
        </section>

        <section>
          <h2 className="text-cyan font-bold mb-1">Age verification</h2>
          <p>
            Randomster is restricted to users 18 and older and uses a third-party identity verification
            provider to confirm this. Verification data is handled by that provider under their own
            privacy terms; Randomster stores only a verification status and reference ID, never raw
            identity documents.
          </p>
        </section>

        <section>
          <h2 className="text-cyan font-bold mb-1">Your rights</h2>
          <p>
            You can export your data or permanently delete your account at any time from Settings. Deletion
            removes your profile and cascades to your matches, messages, and blocks; reports you filed and
            moderation records are retained for trust & safety purposes.
          </p>
        </section>
      </div>
    </div>
  );
}
