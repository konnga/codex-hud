export const HUD_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: CanvasText; background: transparent; }
    main { min-width: 320px; padding: 12px; }
    header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    h1 { margin: 0; font-size: 14px; font-weight: 700; }
    .spacer { flex: 1; }
    button { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 7px; background: color-mix(in srgb, Canvas 92%, CanvasText 8%); color: inherit; padding: 5px 8px; font: inherit; cursor: pointer; }
    .meta { color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 11px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .card { padding: 9px; border: 1px solid color-mix(in srgb, CanvasText 13%, transparent); border-radius: 10px; background: color-mix(in srgb, Canvas 96%, CanvasText 4%); min-width: 0; }
    .wide { grid-column: 1 / -1; }
    .label { color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .value { margin-top: 3px; font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { height: 5px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, CanvasText 12%, transparent); }
    .bar > i { display: block; height: 100%; border-radius: inherit; background: #10b981; }
    ul { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 4px; }
    li { display: flex; gap: 6px; align-items: baseline; min-width: 0; font-size: 11px; }
    li span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #9ca3af; }
    .running { background: #f59e0b; } .completed { background: #10b981; } .error { background: #ef4444; }
    #error { display: none; padding: 10px; border-radius: 9px; background: color-mix(in srgb, #ef4444 12%, Canvas); color: #ef4444; font-size: 12px; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Codex HUD</h1><span id="binding" class="meta"></span><span class="spacer"></span>
    <button id="pip" title="Keep the HUD visible">Picture in picture</button>
    <button id="refresh">Refresh</button>
  </header>
  <div id="error"></div>
  <section id="grid" class="grid"></section>
</main>
<script>
  const esc = value => String(value ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
  const pct = value => Math.max(0, Math.min(100, Number(value) || 0));
  const card = (label, value, extra = "") => '<div class="card"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div>' + extra + '</div>';
  const bar = value => '<div class="bar"><i style="width:' + pct(value) + '%"></i></div>';
  const list = items => '<ul>' + items.map(item => '<li><i class="dot ' + esc(item.status) + '"></i><span>' + esc(item.name) + '</span><span class="meta">' + esc(item.detail || "") + '</span></li>').join("") + '</ul>';
  let snapshot = window.openai?.toolOutput?.snapshot || window.openai?.toolOutput || null;

  function render(next) {
    if (!next) return;
    snapshot = next.snapshot || next;
    const error = document.getElementById("error");
    if (!snapshot?.session) {
      error.style.display = "block";
      error.textContent = next.error || "No local Codex session is bound.";
      document.getElementById("grid").innerHTML = "";
      return;
    }
    error.style.display = "none";
    const s = snapshot.session;
    const context = snapshot.context;
    const usage = snapshot.usage;
    const git = snapshot.git;
    document.getElementById("binding").textContent = s.id.slice(0, 8);
    const tools = snapshot.tools.slice(-5).reverse().map(x => ({ status: x.status, name: x.name, detail: x.target }));
    const agents = snapshot.agents.slice(-5).reverse().map(x => ({ status: x.status, name: x.type, detail: x.description }));
    const tasks = snapshot.todos.slice(0, 6).map(x => ({ status: x.status === "in_progress" ? "running" : x.status, name: x.content }));
    const sections = [
      card("Model", [s.model, s.reasoningEffort].filter(Boolean).join(" · ") || "—"),
      card("Project", snapshot.project.projectName || snapshot.project.cwd),
      card("Context", context ? context.remainingPercent + "% remaining" : "—", context ? bar(context.percent) : ""),
      card("Usage", usage?.secondary ? (100 - pct(usage.secondary.percent)) + "% remaining" : "—", usage?.secondary ? bar(usage.secondary.percent) : ""),
      card("Git", git?.isGitRepo ? [git.branch, git.isDirty ? "dirty" : "clean", git.ahead ? "↑" + git.ahead : "", git.behind ? "↓" + git.behind : ""].filter(Boolean).join(" · ") : "Not a Git repository"),
      card("Tokens", snapshot.sessionTokens ? snapshot.sessionTokens.totalTokens.toLocaleString() : "—"),
      '<div class="card wide"><div class="label">Activity</div>' + list(tools.length ? tools : [{ status: "completed", name: "No recent tools" }]) + '</div>',
    ];
    if (agents.length) sections.push('<div class="card wide"><div class="label">Agents</div>' + list(agents) + '</div>');
    if (tasks.length) sections.push('<div class="card wide"><div class="label">Tasks</div>' + list(tasks) + '</div>');
    document.getElementById("grid").innerHTML = sections.join("");
  }

  async function refresh() {
    if (!window.openai?.callTool) return;
    const result = await window.openai.callTool("codex_hud_refresh", { sessionId: snapshot?.session?.id });
    render(result?.structuredContent || result);
  }

  document.getElementById("refresh").addEventListener("click", () => refresh().catch(console.error));
  document.getElementById("pip").addEventListener("click", async () => {
    if (window.openai?.requestDisplayMode) await window.openai.requestDisplayMode({ mode: "pip" });
  });
  render(snapshot);
  setInterval(() => refresh().catch(() => {}), 2000);
</script>
</body>
</html>`
