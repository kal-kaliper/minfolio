// Bridge abstraction layer for mindmap server interactions.
// Supports three backends:
//   'http'    - uses fetch/EventSource (default, for standalone dev with server.js)
//   'flutter' - uses JavaScript channels to communicate with Dart host app
//   'host'    - uses postMessage to the parent window (Folio embeds the engine
//               in an iframe and answers bridge calls from the host page)
//
// The host sets window._mindmapBridge = 'flutter' | 'host' before loading app.js.
// For 'flutter', Dart calls window._bridgeReceive(callId, jsonPayload).
// For 'host', the parent posts {source:'mindmap-host', callId, payload} replies
// and {source:'mindmap-host', event} change notifications back to this iframe.

const Bridge = (() => {
  const mode = () => window._mindmapBridge || 'http';
  const isEmbedded = () => mode() === 'flutter' || mode() === 'host';

  // Pending call tracking (shared by flutter + host transports).
  let _callId = 0;
  const _pending = new Map();
  let _fileChangeHandler = null;

  // --- flutter transport: Dart delivers responses via these globals --------
  window._bridgeReceive = (callId, jsonPayload) => {
    const resolver = _pending.get(callId);
    if (resolver) {
      _pending.delete(callId);
      const payload = (typeof jsonPayload === 'string')
        ? JSON.parse(jsonPayload)
        : jsonPayload;
      resolver(payload);
    }
  };
  window._bridgeFileChanged = (jsonPayload) => {
    if (_fileChangeHandler) {
      _fileChangeHandler(JSON.parse(jsonPayload));
    }
  };

  function callFlutter(action, params = {}) {
    return new Promise((resolve) => {
      const id = ++_callId;
      _pending.set(id, resolve);
      if (window.MindmapBridge) {
        window.MindmapBridge.postMessage(JSON.stringify({ callId: id, action, ...params }));
      }
    });
  }

  // --- host transport: postMessage to/from the parent window ---------------
  function callHost(action, params = {}) {
    return new Promise((resolve) => {
      const id = ++_callId;
      _pending.set(id, resolve);
      window.parent.postMessage({ source: 'mindmap', callId: id, action, ...params }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'mindmap-host') return;
    if (data.event) {
      if (_fileChangeHandler) _fileChangeHandler(data.event);
      return;
    }
    const resolver = _pending.get(data.callId);
    if (resolver) {
      _pending.delete(data.callId);
      resolver(data.payload);
    }
  });

  // Route an embedded call to whichever transport is active.
  function call(action, params = {}) {
    return mode() === 'host' ? callHost(action, params) : callFlutter(action, params);
  }

  return {
    isFlutter() {
      // True for any embedded host (used to hide standalone-only chrome and
      // route fullscreen requests to the host instead of the browser).
      return isEmbedded();
    },

    async getConfig() {
      if (isEmbedded()) return call('getConfig');
      const resp = await fetch('/api/config');
      return resp.json();
    },

    async loadFile(filePath) {
      if (isEmbedded()) return call('loadFile', { filePath });
      const resp = await fetch(`/api/file?file=${encodeURIComponent(filePath)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to load file');
      return data;
    },

    async saveFile(filePath, markdown, baseRevision) {
      if (isEmbedded()) return call('saveFile', { filePath, markdown, baseRevision });
      const resp = await fetch(`/api/file?file=${encodeURIComponent(filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, baseRevision }),
      });
      const data = await resp.json();
      data._status = resp.status;
      if (!resp.ok && resp.status !== 409) throw new Error(data.error || 'Save failed');
      return data;
    },

    async listDir(dir) {
      if (isEmbedded()) return call('listDir', { dir: dir || '' });
      const url = dir ? `/api/list?dir=${encodeURIComponent(dir)}` : '/api/list';
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to list directory');
      return data;
    },

    async importFile(name, markdown, dir) {
      if (isEmbedded()) return call('importFile', { name, markdown, dir });
      const resp = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, markdown, dir }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import failed');
      return data;
    },

    // Request fullscreen toggle from the host.
    toggleFullscreen() {
      if (isEmbedded()) call('toggleFullscreen');
    },

    // Subscribe to file-change events. Returns a cleanup function.
    watchFile(filePath, onChanged) {
      if (isEmbedded()) {
        _fileChangeHandler = onChanged;
        call('watchFile', { filePath });
        return () => {
          _fileChangeHandler = null;
          call('unwatchFile', { filePath });
        };
      }

      const es = new EventSource(`/events?file=${encodeURIComponent(filePath)}`);
      es.onmessage = (event) => {
        try {
          onChanged(JSON.parse(event.data));
        } catch (_err) { /* ignore parse errors */ }
      };
      return () => es.close();
    },
  };
})();
