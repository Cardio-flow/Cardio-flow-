import { useEffect, useState } from "react";
import { api, type Session } from "./api";
import { Logo, initials } from "./ui";

export function SignIn({ hosted, onSignedIn }: { hosted: boolean; onSignedIn(s: Session): void }) {
  return (
    <div className="signin">
      <div className="brand">
        <Logo dark size={48} />
        <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.8, maxWidth: 460 }}>A cardiologist's second brain.</h1>
        <p>One patient journey from admission to clinic. Structured entry, clear alerts, and plans that follow themselves up.</p>
      </div>
      <div className="form">{hosted ? <HostedSignIn onSignedIn={onSignedIn} /> : <DemoSignIn onSignedIn={onSignedIn} />}</div>
    </div>
  );
}

function DemoSignIn({ onSignedIn }: { onSignedIn(s: Session): void }) {
  const [users, setUsers] = useState<{ email: string; display_name: string; role: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/demo-users").then(setUsers).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="users">
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)" }}>Choose a user</h2>
        <p className="muted" style={{ margin: "6px 0 0", fontWeight: 500 }}>Local sandbox with synthetic patients only.</p>
      </div>
      {users.map((u) => (
        <button
          key={u.email}
          className="user-pick"
          onClick={async () => {
            try {
              onSignedIn(await api("/demo-session", { body: { email: u.email } }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <span className="pt-avatar" style={{ width: 44, height: 44, fontSize: 15, borderRadius: 12 }}>{initials(u.display_name)}</span>
          <span className="col" style={{ gap: 2 }}>
            <b style={{ fontSize: 15 }}>{u.display_name}</b>
            <span className="muted small" style={{ fontWeight: 600, textTransform: "capitalize" }}>{u.role}</span>
          </span>
        </button>
      ))}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

type Mode = "sign-in" | "sign-up" | "reset" | "new-password" | "verify";
function HostedSignIn({ onSignedIn }: { onSignedIn(s: Session): void }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<Mode>(params.has("token") ? "new-password" : params.has("verify") ? "verify" : "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const switchTo = (m: Mode) => {
    setMode(m);
    setError("");
    setMessage("");
  };
  async function call(path: string, body: unknown) {
    const r = await fetch("/api/auth/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.message || result.error?.message || "Sign-in request failed");
    return result;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "verify") {
        await call("email-otp/verify-email", { email: email.trim(), otp: otp.trim() });
        history.replaceState({}, "", "/");
        switchTo("sign-in");
        setMessage("Email verified. Sign in to enter your workspace.");
      } else if (mode === "reset") {
        await call("request-password-reset", { email, redirectTo: location.origin });
        setMessage("If this email has an account, a password reset link has been sent.");
      } else if (mode === "new-password") {
        await call("reset-password", { newPassword: password, token: params.get("token") });
        history.replaceState({}, "", "/");
        switchTo("sign-in");
        setMessage("Password updated. You can sign in now.");
      } else {
        await call(mode + "/email", { email, password, ...(mode === "sign-up" ? { name, callbackURL: location.origin } : {}) });
        if (mode === "sign-up") {
          setMode("verify");
          await call("email-otp/send-verification-otp", { email, type: "email-verification" });
          setMessage("Enter the verification code from your email. Workspace approval is also required.");
          return;
        }
        const r = await fetch("/api/session");
        const result = await r.json();
        if (r.ok) onSignedIn(result);
        else {
          if (result.error?.includes("Verify your email")) setMode("verify");
          setMessage(result.error);
        }
      }
    } catch (err) {
      if (/email.*not.*verified/i.test((err as Error).message)) setMode("verify");
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)" }}>
        {{ "sign-in": "Sign in", "sign-up": "Create account", reset: "Reset password", "new-password": "Choose a new password", verify: "Verify your email" }[mode]}
      </h2>
      {mode === "sign-up" && (
        <label className="field">
          <span>Your name</span>
          <input className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      {mode !== "new-password" && (
        <label className="field">
          <span>Email address</span>
          <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      )}
      {mode === "verify" && (
        <label className="field">
          <span>Verification code</span>
          <input className="input" required autoComplete="one-time-code" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value)} />
        </label>
      )}
      {mode !== "reset" && mode !== "verify" && (
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? "Please wait…" : { verify: "Verify email", "sign-up": "Create account", reset: "Send reset link", "new-password": "Update password", "sign-in": "Sign in" }[mode]}
      </button>
      <div className="row wrap" style={{ justifyContent: "space-between" }}>
        {mode === "verify" ? (
          <>
            <button type="button" className="btn ghost small" disabled={busy || !email} onClick={() => call("email-otp/send-verification-otp", { email: email.trim(), type: "email-verification" }).then(() => setMessage("A new code was requested. Use the newest one."), (e) => setError(e.message))}>
              Resend code
            </button>
            <button type="button" className="btn ghost small" onClick={() => switchTo("sign-in")}>Back to sign in</button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost small" onClick={() => switchTo(mode === "sign-up" ? "sign-in" : "sign-up")}>
              {mode === "sign-up" ? "Sign in instead" : "Create an account"}
            </button>
            <button type="button" className="btn ghost small" onClick={() => switchTo(mode === "reset" ? "sign-in" : "reset")}>
              {mode === "reset" ? "Back to sign in" : "Forgot password?"}
            </button>
            <button type="button" className="btn ghost small" onClick={() => switchTo("verify")}>Enter verification code</button>
          </>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      {message && <p role="status" style={{ fontWeight: 600, color: "var(--ink-3)" }}>{message}</p>}
    </form>
  );
}
