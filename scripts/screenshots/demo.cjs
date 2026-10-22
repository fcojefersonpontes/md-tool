// Runs inside the VS Code extension host (as a test module) and captures the README images.
// Started by scripts/screenshots/run.mjs; frames and shots go to $MDTOOL_SHOTS.
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const out = process.env.MDTOOL_SHOTS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, ...args) => vscode.commands.executeCommand(command, ...args);

/** A long-lived capture.ps1 process: one PNG per request. */
function startCapture() {
  const ps = spawn(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, 'capture.ps1'),
      '-Title',
      'md-tool-demo',
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const waiting = [];
  let buffer = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) !== -1;) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) waiting.shift()?.(line);
    }
  });
  return {
    shot: (file) =>
      new Promise((resolve, reject) => {
        waiting.push((line) => (line === 'ok' ? resolve() : reject(new Error(line))));
        ps.stdin.write(file + '\n');
      }),
    close: () => ps.stdin.end(),
  };
}

/** Animation frames: each PNG is shown for `delay` ms. */
function recorder(capture, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  return {
    async frame(delay, settle = 250) {
      await sleep(settle);
      const file = path.join(dir, `${String(frames.length).padStart(3, '0')}.png`);
      await capture.shot(file);
      frames.push({ file, delay });
    },
    save: () => fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(frames, null, 2)),
  };
}

async function waitForFile(file, timeout = 60000) {
  for (const start = Date.now(); Date.now() - start < timeout; await sleep(250)) {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function cleanLayout() {
  await run('workbench.action.closeAllEditors');
  await run('workbench.action.closeSidebar');
  await run('workbench.action.closePanel');
  await run('workbench.action.closeAuxiliaryBar');
  await run('notifications.clearAll');
}

async function previewShots(capture, folder) {
  const demo = vscode.Uri.joinPath(folder, 'demo.md');
  const editor = await vscode.window.showTextDocument(demo);
  await run('mdTool.openPreviewToSide');
  await sleep(5000);
  await capture.shot(path.join(out, 'preview.png'));

  // Scroll sync: move the editor to the formula and diagram.
  const line = editor.document.getText().split('\n').indexOf('$$');
  editor.revealRange(new vscode.Range(line - 2, 0, line - 2, 0), vscode.TextEditorRevealType.AtTop);
  await sleep(8000); // the first diagram waits for mermaid.min.js (~3 MB) to load
  await capture.shot(path.join(out, 'preview-math.png'));
}

async function exportShot(capture, folder) {
  // Same layout as the preview shots: editor and preview side by side.
  await run('notifications.clearAll');
  const demo = vscode.Uri.joinPath(folder, 'demo.md');
  await vscode.window.showTextDocument(demo, vscode.ViewColumn.One);
  void run('mdTool.exportPdf', demo);
  await waitForFile(path.join(folder.fsPath, 'demo.pdf'));
  await sleep(1500);
  await capture.shot(path.join(out, 'export.png'));
  await run('notifications.clearAll');

  void run('mdTool.exportRtf', demo);
  await waitForFile(path.join(folder.fsPath, 'demo.rtf'));
  await sleep(1000);
  await run('notifications.clearAll');
  for (const ext of ['pdf', 'rtf']) {
    fs.copyFileSync(path.join(folder.fsPath, `demo.${ext}`), path.join(out, `demo.${ext}`));
  }
}

async function editingAnimation(capture, folder) {
  await cleanLayout();
  const file = vscode.Uri.joinPath(folder, 'notes.md');
  fs.writeFileSync(file.fsPath, '# Trip notes\n\n');
  const editor = await vscode.window.showTextDocument(file);
  editor.selection = new vscode.Selection(2, 0, 2, 0);
  await run('mdTool.openPreviewToSide');
  await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One);
  await sleep(2500);

  const rec = recorder(capture, path.join(out, 'editing'));
  const type = async (text) => {
    for (const word of text.match(/\S+\s*|\s+/g)) {
      await run('type', { text: word });
      await rec.frame(180);
    }
  };
  const enter = async (pause = 700) => {
    await run('mdTool.onEnterKey');
    await rec.frame(pause);
  };

  await rec.frame(1000);
  // Lists continue on Enter; Enter on an empty item ends the list.
  await type('- [ ] Book flights');
  await enter();
  await type('Pack the camera');
  await enter();
  await type('Renew passport');
  await enter(900);
  await enter(900); // empty item: ends the list
  await enter(300); // plain newline

  // Ctrl+B on a selection.
  await type('Leave on Friday morning.');
  const line = editor.selection.active.line;
  const text = editor.document.lineAt(line).text;
  const start = text.indexOf('Friday morning');
  editor.selection = new vscode.Selection(line, start, line, start + 'Friday morning'.length);
  await rec.frame(900);
  await run('mdTool.toggleBold');
  await rec.frame(1400, 600);

  // A rough table, then Format Document.
  const end = editor.document.lineAt(line).range.end;
  editor.selection = new vscode.Selection(end, end);
  await editor.edit((e) => e.insert(end, '\n\n'));
  for (const row of ['|Day|City|Budget|', '|-|-|-:|', '|Fri|Lisbon|€120|', '|Sat|Porto|€95|']) {
    const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    await editor.edit((e) => e.insert(end, row + '\n'));
    await rec.frame(350);
  }
  await rec.frame(900);
  await run('editor.action.formatDocument');
  await rec.frame(3500, 800);

  rec.save();
  await editor.document.save();
}

exports.run = async function () {
  const capture = startCapture();
  try {
    const folder = vscode.workspace.workspaceFolders[0].uri;
    await vscode.extensions.getExtension('JefersonPontes.md-tool').activate();
    await cleanLayout();
    // The first capture sizes the window and keeps it on top.
    await capture.shot(path.join(out, 'warmup.png'));
    await sleep(1500);
    await previewShots(capture, folder);
    await exportShot(capture, folder);
    await editingAnimation(capture, folder);
  } finally {
    capture.close();
  }
};
