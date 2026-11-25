// Dev tool: evaluate JS in a headless Obsidian (see scripts/obsidian-headless.sh) and optionally screenshot.
// usage: node cdp.mjs <file-with-js-expression>   (evaluates in the Obsidian window, awaits promises, prints JSON)
import { readFileSync } from 'node:fs';
const expr = readFileSync(process.argv[2], 'utf8');
let targets;
for (let i = 0; i < 90; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9335/json')).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
  await new Promise(r => setTimeout(r, 1000));
}
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' ')); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)); });
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable', {});
await send('Emulation.setFocusEmulationEnabled', { enabled: true }); // paint the caret although the window isn't focused
const res = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
await new Promise(r => setTimeout(r, 300));
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 1));
if (process.argv[3]) {
  const clip = res.result?.result?.value?.__clip; // a script may return { __clip: {x,y,width,height} } to zoom in
  const shot = await send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 2 } } : { format: 'png' });
  (await import('node:fs')).writeFileSync(process.argv[3], Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot ->', process.argv[3]);
}
if (logs.length) console.log('--- console:\n' + logs.join('\n'));
ws.close();
