import { useState } from "react";
import { ErrorBox } from "./ui";
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<
    "sign-in" | "sign-up" | "reset" | "new-password" | "verify"
  >(
    new URLSearchParams(location.search).has("token")
      ? "new-password"
      : new URLSearchParams(location.search).has("verify")
        ? "verify"
        : "sign-in",
  );
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function call(path: string, body: unknown) {
    const response = await fetch("/api/auth/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message || result.error?.message || "Sign-in request failed",
      );
    return result;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "verify") {
        await call("email-otp/verify-email", {
          email: email.trim(),
          otp: otp.trim(),
        });
        setOtp("");
        setPassword("");
        history.replaceState({}, "", "/");
        setMode("sign-in");
        setMessage("Email verified. Sign in to enter your workspace.");
      } else if (mode === "reset") {
        await call("request-password-reset", {
          email,
          redirectTo: location.origin,
        });
        setMessage(
          "If this email has an account, a password reset link has been sent.",
        );
      } else if (mode === "new-password") {
        await call("reset-password", {
          newPassword: password,
          token: new URLSearchParams(location.search).get("token"),
        });
        history.replaceState({}, "", "/");
        setMode("sign-in");
        setMessage("Password updated. You can sign in now.");
      } else {
        await call(mode + "/email", {
          email,
          password,
          ...(mode === "sign-up" ? { name, callbackURL: location.origin } : {}),
        });
        if (mode === "sign-up") {
          setMode("verify");
          await call("email-otp/send-verification-otp", {
            email,
            type: "email-verification",
          });
          setMessage(
            "Enter the verification code from your email. Workspace approval is also required.",
          );
          return;
        }
        const response = await fetch("/api/session");
        if (response.ok) onSignedIn();
        else {
          const result = await response.json();
          if (result.error?.includes("Verify your email")) setMode("verify");
          setMessage(result.error);
        }
      }
    } catch (e) {
      if (/email.*not.*verified/i.test((e as Error).message)) setMode("verify");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await call("email-otp/send-verification-otp", {
        email: email.trim(),
        type: "email-verification",
      });
      setMessage(
        "A new verification code was requested. Check your inbox and spam folder; use the newest code.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="auth-form">
      {mode === "sign-up" && (
        <label>
          Your name
          <input
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      {mode !== "new-password" && (
        <label>
          Email address
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}
      {mode === "verify" && (
        <label>
          Verification code
          <input
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
        </label>
      )}
      {mode !== "reset" && mode !== "verify" && (
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      <button className="primary" disabled={busy}>
        {busy
          ? "Please wait…"
          : mode === "verify"
            ? "Verify email"
            : mode === "sign-up"
              ? "Create account"
              : mode === "reset"
                ? "Send reset link"
                : mode === "new-password"
                  ? "Update password"
                  : "Sign in"}
      </button>
      {mode === "verify" ? (
        <div className="auth-links">
          <button type="button" disabled={busy || !email} onClick={resend}>
            Resend verification code
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("sign-in");
              setError("");
              setMessage("");
            }}
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="verification-link"
          onClick={() => {
            setMode("verify");
            setError("");
            setMessage("");
          }}
        >
          Enter verification code
        </button>
      )}
      <div className="auth-links">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-up" ? "sign-in" : "sign-up");
            setError("");
            setMessage("");
          }}
        >
          {mode === "sign-up" ? "Sign in instead" : "Create an account"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "reset" ? "sign-in" : "reset")}
        >
          {mode === "reset" ? "Back to sign in" : "Forgot password?"}
        </button>
      </div>
      <ErrorBox message={error} />
      {message && <p role="status">{message}</p>}
    </form>
  );
}
