// Fixture-only preload. Inspect socket metadata without reading headers or bodies.
const { channel } = require('node:diagnostics_channel');
const { appendFileSync } = require('node:fs');
const { isIP } = require('node:net');

const destination = process.env.ZF_FIXTURE_NETWORK_EVENTS;
if (destination) {
  const record = (event) => appendFileSync(destination, JSON.stringify({ ...event, pid: process.pid }) + '\n');
  record({ event: 'preloaded' });

  function classify(request) {
    const host = new URL(request.origin).hostname;
    if (host === 'github.com' && request.path.startsWith('/k2-fsa/sherpa-onnx/releases/download/')) {
      return 'sherpa-release';
    }
    if (host === 'release-assets.githubusercontent.com' || host === 'objects.githubusercontent.com') {
      return 'github-release-cdn';
    }
    return 'other';
  }

  channel('undici:request:create').subscribe(({ request }) => {
    record({ event: 'request', destination: classify(request) });
  });
  channel('undici:client:sendHeaders').subscribe(({ request, socket }) => {
    const peer = socket.remoteAddress;
    const loopback = peer === '::1' || /^(?:::ffff:)?127\./i.test(peer ?? '');
    if (isIP(peer) && !loopback) {
      record({
        event: 'nonloopback-socket',
        destination: classify(request),
        localPort: socket.localPort,
        remotePort: socket.remotePort,
      });
    }
  });
}
