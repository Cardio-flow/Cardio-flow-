import { createRoot } from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/outfit/700.css";
import "./styles.css";
import { Component, type ReactNode } from "react";
import { App } from "./App";

// a crash anywhere in the app shows what failed and a reload, never a blank page (20 Oct 2026)
class Guard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="boot-state" role="alert">
        <h1>CardioFlow could not open this screen</h1>
        <p>{this.state.error.message}</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(<Guard><App /></Guard>);
window.dispatchEvent(new Event("cardio:ready"));
