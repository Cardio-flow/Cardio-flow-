import { useState } from "react";
import { ErrorBox } from "./ui";
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<
    "sign-in" | "sign-up" | "reset" | "new-password"
  >(
    new URLSearchParams(location.search).has("token")
      ? "new-password"
      : "sign-in",
  );
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
      if (mode === "reset") {
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
        const response = await fetch("/api/session");
        if (response.ok) onSignedIn();
        else {
          const result = await response.json();
          setMessage(
            mode === "sign-up"
              ? "Account created. Check your email to verify your address, then sign in. Workspace approval is required."
              : result.error,
          );
        }
      }
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
      {mode !== "reset" && (
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
          : mode === "sign-up"
            ? "Create account"
            : mode === "reset"
              ? "Send reset link"
              : mode === "new-password"
                ? "Update password"
                : "Sign in"}
      </button>
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
