export function getTesterHtml(method: string, url: string): string {
  const escapedUrl = url.replace(/"/g, '&quot;');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    :root {
      --bg: #05060a;
      --panel: rgba(10, 12, 20, 0.95);
      --border-subtle: rgba(120, 130, 160, 0.3);
      --accent: #00ffc6;
      --accent-soft: rgba(0, 255, 198, 0.15);
      --accent-strong: rgba(0, 255, 198, 0.6);
      --danger: #ff4b81;
      --danger-soft: rgba(255, 75, 129, 0.14);
      --text: #f5f7ff;
      --text-muted: #9ba3c1;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
        monospace;
    }

    body {
      margin: 0;
      padding: 16px 18px;
      min-height: 100vh;
      box-sizing: border-box;
      background:
        radial-gradient(circle at 0% 0%, rgba(0, 255, 198, 0.12), transparent 55%),
        radial-gradient(circle at 100% 100%, rgba(111, 66, 193, 0.18), transparent 55%),
        var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
    }

    .app {
      max-width: 980px;
      margin: 0 auto;
      background: var(--panel);
      border-radius: 14px;
      padding: 14px 14px 16px;
      border: 1px solid rgba(255, 255, 255, 0.03);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.65),
        0 18px 45px rgba(0, 0, 0, 0.75),
        0 0 40px rgba(0, 255, 198, 0.08);
      backdrop-filter: blur(16px);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      gap: 8px;
    }

    .title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent-strong);
    }

    .badge {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.1fr);
      gap: 10px;
    }

    @media (max-width: 880px) {
      .grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .card {
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      padding: 10px 10px 9px;
      background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.018),
        rgba(10, 12, 20, 0.9)
      );
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 7px;
    }

    .card-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-muted);
    }

    .pill {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }

    .row {
      margin-bottom: 7px;
    }

    label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-muted);
      display: block;
      margin-bottom: 3px;
    }

    .method-url-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    select,
    input[type="text"],
    textarea {
      width: 100%;
      box-sizing: border-box;
      border-radius: 7px;
      border: 1px solid var(--border-subtle);
      background: rgba(3, 6, 13, 0.9);
      padding: 6px 8px;
      font-size: 12px;
      color: var(--text);
      outline: none;
      font-family: var(--mono);
      transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
    }

    select {
      max-width: 86px;
      flex-shrink: 0;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.08em;
    }

    input[type="text"] {
      font-family: var(--mono);
    }

    textarea {
      min-height: 90px;
      resize: vertical;
    }

    select:focus,
    input[type="text"]:focus,
    textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent-soft);
      background: rgba(6, 10, 20, 1);
    }

    .hint {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
      opacity: 0.8;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }

    button {
      border-radius: 999px;
      border: none;
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      color: #020309;
      background: radial-gradient(circle at 0% 0%, #ffffff, #dafdf4);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.65),
        0 0 14px rgba(0, 255, 198, 0.55);
      transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
    }

    button:hover {
      transform: translateY(-0.5px) scale(1.01);
      filter: brightness(1.03);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.65),
        0 0 22px rgba(0, 255, 198, 0.8);
    }

    button:active {
      transform: translateY(0.5px) scale(0.99);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.7),
        0 0 10px rgba(0, 255, 198, 0.4);
    }

    .response-body {
      margin-top: 6px;
      border-radius: 8px;
      padding: 7px 8px;
      background: radial-gradient(circle at 0% 0%, rgba(0, 255, 198, 0.05), rgba(5, 8, 15, 0.98));
      border: 1px solid rgba(0, 0, 0, 0.85);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
      font-family: var(--mono);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 260px;
      overflow: auto;
    }

    .response-placeholder {
      opacity: 0.4;
      font-style: italic;
    }

    .status-line {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .status-chip {
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 11px;
      font-family: var(--mono);
    }

    .status-ok {
      color: var(--accent);
      border-color: var(--accent-soft);
      background: radial-gradient(circle at 0% 0%, rgba(0, 255, 198, 0.12), transparent);
      box-shadow: 0 0 8px rgba(0, 255, 198, 0.4);
    }

    .status-error {
      color: var(--danger);
      border-color: var(--danger-soft);
      background: radial-gradient(circle at 0% 0%, rgba(255, 75, 129, 0.12), transparent);
      box-shadow: 0 0 8px rgba(255, 75, 129, 0.4);
    }

    .headers {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 4px;
      white-space: pre-wrap;
    }

    .response {
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <div class="title">
        <span class="title-dot"></span>
        <span>API Probe · Express Route Tester</span>
      </div>
      <div class="badge">Preview</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Request</div>
          <div class="pill">Client → Server</div>
        </div>

        <div class="row">
          <label>Target</label>
          <div class="method-url-row">
            <select id="method">
              ${['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
                .map(
                  (m) =>
                    `<option value="${m}" ${
                      m === method ? 'selected' : ''
                    }>${m}</option>`
                )
                .join('')}
            </select>
            <input id="url" type="text" value="${escapedUrl}" />
          </div>
          <div class="hint">Edit method or URL if needed before sending.</div>
        </div>

        <div class="row">
          <label>Headers (JSON)</label>
          <textarea
            id="headers"
            placeholder='{"Content-Type": "application/json"}'
          ></textarea>
          <div class="hint">Optional. Must be valid JSON if provided.</div>
        </div>

        <div class="row">
          <label>Body</label>
          <textarea
            id="body"
            placeholder='{"foo": "bar"}'
          ></textarea>
          <div class="hint">Ignored for GET/HEAD.</div>
        </div>

        <div class="actions">
          <button id="send">Send Request</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Response</div>
          <div class="pill">Server → Client</div>
        </div>
        <div class="response" id="response">
          <div class="response-body response-placeholder">
            No response yet. Hit “Send Request” to probe this endpoint.
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const methodEl = document.getElementById('method');
    const urlEl = document.getElementById('url');
    const headersEl = document.getElementById('headers');
    const bodyEl = document.getElementById('body');
    const responseEl = document.getElementById('response');
    const sendBtn = document.getElementById('send');

    sendBtn.addEventListener('click', () => {
      responseEl.innerHTML = '<div class="response-body">Sending…</div>';
      vscode.postMessage({
        type: 'sendRequest',
        method: methodEl.value,
        url: urlEl.value,
        headersText: headersEl.value,
        body: bodyEl.value
      });
    });

    function prettyMaybeJson(text) {
      try {
        const obj = JSON.parse(text);
        return JSON.stringify(obj, null, 2);
      } catch {
        return text;
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'response') {
        const statusOk = !!msg.ok;
        const statusClass = statusOk ? 'status-ok' : 'status-error';
        const statusLabel = statusOk ? 'OK' : 'Error';

        const headersJson = JSON.stringify(msg.headers, null, 2);
        const bodyFormatted = prettyMaybeJson(msg.body);

        responseEl.innerHTML = '';

        const container = document.createElement('div');

        const statusLine = document.createElement('div');
        statusLine.className = 'status-line';
        statusLine.innerHTML = \`
          <span class="status-chip \${statusClass}">
            \${msg.status} · \${statusLabel}
          </span>
          <span>\${msg.statusText || ''}</span>
        \`;

        const headersDiv = document.createElement('div');
        headersDiv.className = 'headers';
        headersDiv.textContent = headersJson;

        const bodyPre = document.createElement('pre');
        bodyPre.className = 'response-body';
        bodyPre.textContent = bodyFormatted;

        container.appendChild(statusLine);
        container.appendChild(headersDiv);
        container.appendChild(bodyPre);

        responseEl.appendChild(container);
      } else if (msg.type === 'error') {
        responseEl.innerHTML = '';
        const bodyPre = document.createElement('pre');
        bodyPre.className = 'response-body';
        bodyPre.textContent = 'Error: ' + msg.message;
        responseEl.appendChild(bodyPre);
      }
    });
  </script>
</body>
</html>`;
}
