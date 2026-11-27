// Preload in isolated Paseo Node processes. Record socket metadata, never payloads, headers or URLs.
const { appendFileSync } = require("node:fs");
const { channel } = require("node:diagnostics_channel");
const { Socket } = require("node:net");

const file = process.env.ZF_T08_NETWORK;
if (file) {
  const record = (event, fields = {}) => appendFileSync(file,
    JSON.stringify({ event, time: new Date().toISOString(), pid: process.pid, ...fields }) + "\n");
  const origin = () => {
    const stack = new Error().stack.replaceAll("\\", "/");
    if (/zelqio-flow|zelqio-t08/.test(stack.split("\n").slice(3).join("\n"))) return "zelqio-frame";
    return "unattributed";
  };
  function endpoints(socket) {
    return { family: socket.remoteFamily, localAddress: socket.localAddress, localPort: socket.localPort,
      remoteAddress: socket.remoteAddress, remotePort: socket.remotePort };
  }
  function destination(request) {
    const host = new URL(request.origin).hostname;
    if (host === "github.com" && request.path.startsWith("/k2-fsa/sherpa-onnx/releases/download/")) {
      return { host, purpose: "paseo-speech-release" };
    }
    if (host === "release-assets.githubusercontent.com" || host === "objects.githubusercontent.com") {
      return { host, purpose: "github-release-cdn" };
    }
    return { host, purpose: "unattributed" };
  }
  record("process", { parent: process.ppid });
  const connect = Socket.prototype.connect;
  Socket.prototype.connect = function (...args) {
    const source = origin();
    this.once("connect", () => record("outbound", { source, ...endpoints(this) }));
    return Reflect.apply(connect, this, args);
  };
  channel("net.server.socket").subscribe(({ socket }) => record("inbound", endpoints(socket)));
  channel("undici:request:create").subscribe(({ request }) =>
    record("http-request", { ...destination(request), source: origin() }));
  channel("undici:client:sendHeaders").subscribe(({ request, socket }) =>
    record("http-socket", { ...destination(request), ...endpoints(socket) }));
}
