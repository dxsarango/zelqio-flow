// Disposable POC (S00-T02): tiny Chrome DevTools Protocol helper (no dependencies; Node >= 22 global WebSocket).
//   node cdp.mjs <port> eval  "<js expression>"        -> prints the JSON result
//   node cdp.mjs <port> shot  <file.png>               -> screenshot of the page
//   node cdp.mjs <port> nav   <url> [<seedListen>]     -> navigate; seeds the isolated daemon address before app load
//   node cdp.mjs <port> click "<visible text>"         -> dispatches a real mouse click on the first element whose text matches
//   node cdp.mjs <port> clickxy <x> <y>               -> real mouse click at viewport coordinates
//   node cdp.mjs <port> type  "<text>"                 -> insert text into the focused element
//   node cdp.mjs <port> key   <Enter|Tab|Escape>       -> press a key
const [, , port, cmd, a1, a2] = process.argv;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { error: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "") } : r.result.value; };

if (cmd === "eval") console.log(JSON.stringify(await evaluate(a1)));
else if (cmd === "shot") { const r = await send("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(a1, Buffer.from(r.data, "base64")); console.log("saved"); }
else if (cmd === "nav") {
  await send("Page.enable");
  if (a2) await send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PASEO_INITIAL_DAEMON_CONNECTION__ = ${JSON.stringify({ listen: a2, useTls: false })};` });
  await send("Page.navigate", { url: a1 });
  console.log("navigated");
} else if (cmd === "click") {
  const pos = await evaluate(`(() => { const want = ${JSON.stringify(a1)}; const els = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 || e.getAttribute('role')==='button'); const el = els.find(e => (e.getAttribute('aria-label')||'').includes(want) || (e.textContent||'').trim() === want) ; if(!el) return null; const r = el.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  if (!pos) { console.log("not found"); process.exit(2); }
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pos.x, y: pos.y, button: "left", clickCount: 1 });
  console.log("clicked " + JSON.stringify(pos));
} else if (cmd === "clickxy") {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: Number(a1), y: Number(a2), button: "left", clickCount: 1 });
  console.log("clicked " + a1 + "," + a2);
} else if (cmd === "type") { await send("Input.insertText", { text: a1 }); console.log("typed"); }
else if (cmd === "key") { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: a1, code: a1, windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[a1] }); console.log("key " + a1); }
ws.close();
process.exit(0);
