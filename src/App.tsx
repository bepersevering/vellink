import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    invoke<string>("greet", { name: "Vellink" })
      .then(setGreeting)
      .catch((e) => setGreeting(String(e)));
  }, []);

  return (
    <main className="boot-screen">
      <h1>Vellink</h1>
      <p>{greeting || "正在启动…"}</p>
      <span className="tag">M0 · 地基</span>
    </main>
  );
}

export default App;
