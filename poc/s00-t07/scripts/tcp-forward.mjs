// Disposable POC (S00-T07): TCP forwarder that simulates a tunnel (e.g. SSH -L): a client connecting to the
// forwarded loopback port reaches the daemon although "127.0.0.1" no longer means "the daemon's machine".
//   node tcp-forward.mjs <listenPort> <targetPort>     (ports must stay in 16780-16789)
import net from "node:net";
const [, , listen, target] = process.argv;
net.createServer((c) => { const u = net.connect(Number(target), "127.0.0.1"); c.pipe(u); u.pipe(c); c.on("error", () => u.destroy()); u.on("error", () => c.destroy()); }).listen(Number(listen), "127.0.0.1", () => console.log("forwarding", listen, "->", target));
