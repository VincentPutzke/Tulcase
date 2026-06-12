import * as vscode from 'vscode';
import type { ConflictChoice, ConflictFile } from '../sync/sync-service';

type ResolverMessage =
    | { type: 'resolve'; choices?: Record<string, ConflictChoice> }
    | { type: 'cancel' };

export function openSyncConflictResolver(
    files: ConflictFile[],
): Promise<Map<string, ConflictChoice> | undefined> {
    const panel = vscode.window.createWebviewPanel(
        'tulcaseSyncConflicts',
        'Tulcase Sync Conflicts',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    const nonce = getNonce();
    panel.webview.html = buildHtml(files, nonce);

    return new Promise(resolve => {
        let settled = false;
        const finish = (value: Map<string, ConflictChoice> | undefined) => {
            if (settled) { return; }
            settled = true;
            resolve(value);
            panel.dispose();
        };

        panel.webview.onDidReceiveMessage((msg: ResolverMessage) => {
            if (msg.type === 'cancel') {
                finish(undefined);
                return;
            }

            if (msg.type === 'resolve') {
                const choices = new Map<string, ConflictChoice>();
                for (const file of files) {
                    choices.set(file.path, msg.choices?.[file.path] === 'theirs' ? 'theirs' : 'ours');
                }
                finish(choices);
            }
        });

        panel.onDidDispose(() => {
            if (!settled) {
                settled = true;
                resolve(undefined);
            }
        });
    });
}

function buildHtml(files: ConflictFile[], nonce: string): string {
    const data = toScriptJson(files.map(file => ({
        path: file.path,
        label: file.label,
        base: file.base,
        ours: file.ours,
        theirs: file.theirs,
    })));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root {
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.header,
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

.footer {
  border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  border-bottom: none;
  justify-content: flex-end;
}

.title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.count {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(220px, 280px) 1fr;
  min-height: 0;
}

.list {
  border-right: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  overflow: auto;
  padding: 8px;
}

.row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin: 0 0 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-foreground);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.row:hover {
  background: var(--vscode-list-hoverBackground);
}

.row.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-choice {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.row.active .row-choice {
  color: inherit;
}

.detail {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto 1fr;
  overflow: hidden;
}

.detail-head {
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
}

.file-label {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
}

.file-path {
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  word-break: break-all;
}

.choice-bar {
  display: flex;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
}

.choice,
.action {
  min-height: 30px;
  padding: 5px 12px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 5px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  font: inherit;
  cursor: pointer;
}

.choice.selected,
.action.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.choice:hover,
.action:hover {
  background: var(--vscode-button-hoverBackground);
  color: var(--vscode-button-foreground);
}

.previews {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 12px 18px 18px;
  overflow: auto;
}

.pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  border-radius: 6px;
  overflow: hidden;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
}

.pane-title {
  padding: 7px 10px;
  font-weight: 600;
  border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

pre {
  margin: 0;
  padding: 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  line-height: 1.45;
}

@media (max-width: 760px) {
  .layout,
  .previews {
    grid-template-columns: 1fr;
  }

  .list {
    border-right: none;
    border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    max-height: 180px;
  }
}
</style>
</head>
<body>
<div class="shell">
  <header class="header">
    <div>
      <h1 class="title">Resolve Sync Conflicts</h1>
      <div class="count" id="count"></div>
    </div>
  </header>
  <main class="layout">
    <nav class="list" id="list"></nav>
    <section class="detail">
      <div class="detail-head">
        <h2 class="file-label" id="fileLabel"></h2>
        <div class="file-path" id="filePath"></div>
      </div>
      <div class="choice-bar">
        <button class="choice" id="chooseOurs">Keep Local</button>
        <button class="choice" id="chooseTheirs">Use Remote</button>
      </div>
      <div class="previews">
        <article class="pane">
          <div class="pane-title">Local</div>
          <pre id="ours"></pre>
        </article>
        <article class="pane">
          <div class="pane-title">Remote</div>
          <pre id="theirs"></pre>
        </article>
      </div>
    </section>
  </main>
  <footer class="footer">
    <button class="action" id="cancel">Cancel</button>
    <button class="action primary" id="resolve">Resolve</button>
  </footer>
</div>
<script nonce="${nonce}">
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const files = ${data};
  const choices = Object.create(null);
  let active = 0;

  for (const file of files) {
    choices[file.path] = 'ours';
  }

  const list = document.getElementById('list');
  const count = document.getElementById('count');
  const fileLabel = document.getElementById('fileLabel');
  const filePath = document.getElementById('filePath');
  const ours = document.getElementById('ours');
  const theirs = document.getElementById('theirs');
  const chooseOurs = document.getElementById('chooseOurs');
  const chooseTheirs = document.getElementById('chooseTheirs');
  const cancel = document.getElementById('cancel');
  const resolve = document.getElementById('resolve');

  count.textContent = files.length === 1 ? '1 file' : files.length + ' files';

  function renderList() {
    list.textContent = '';
    files.forEach(function (file, index) {
      const row = document.createElement('button');
      row.className = 'row' + (index === active ? ' active' : '');
      row.type = 'button';
      row.addEventListener('click', function () {
        active = index;
        render();
      });

      const label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = file.label;

      const choice = document.createElement('span');
      choice.className = 'row-choice';
      choice.textContent = choices[file.path] === 'theirs' ? 'Remote' : 'Local';

      row.append(label, choice);
      list.append(row);
    });
  }

  function content(text) {
    if (typeof text !== 'string') {
      return '(deleted)';
    }
    if (text.length > 60000) {
      return text.slice(0, 60000) + '\n\n... truncated for preview ...';
    }
    return text;
  }

  function renderDetail() {
    const file = files[active];
    fileLabel.textContent = file.label;
    filePath.textContent = file.path;
    ours.textContent = content(file.ours);
    theirs.textContent = content(file.theirs);

    chooseOurs.classList.toggle('selected', choices[file.path] !== 'theirs');
    chooseTheirs.classList.toggle('selected', choices[file.path] === 'theirs');
  }

  function render() {
    renderList();
    renderDetail();
  }

  chooseOurs.addEventListener('click', function () {
    choices[files[active].path] = 'ours';
    render();
  });

  chooseTheirs.addEventListener('click', function () {
    choices[files[active].path] = 'theirs';
    render();
  });

  cancel.addEventListener('click', function () {
    vscode.postMessage({ type: 'cancel' });
  });

  resolve.addEventListener('click', function () {
    vscode.postMessage({ type: 'resolve', choices: choices });
  });

  render();
}());
</script>
</body>
</html>`;
}

function toScriptJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}