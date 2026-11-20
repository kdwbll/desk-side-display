import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(source, '..');
const output = resolve(process.argv[2] ?? join(repo, '.archive', 'pages-demo'));

await mkdir(join(output, 'assets'), { recursive: true });
await Promise.all([
  ...['index.html', 'demo.css', 'demo.js', 'demo-api.js', 'demo-data.js', 'frame.js', 'frame.css'].map(file =>
    copyFile(join(source, file), join(output, file))),
  ...['display', 'control', 'shared'].map(directory =>
    cp(join(repo, 'wwwroot', directory), join(output, directory), { recursive: true })),
  cp(join(source, 'assets'), join(output, 'assets'), { recursive: true }),
  copyFile(join(repo, 'docs', 'screenshots', 'desk-setup.jpg'), join(output, 'assets', 'desk-setup.jpg'))
]);

for (const view of ['display', 'control']) {
  const file = join(output, view, 'index.html');
  const html = (await readFile(file, 'utf8'))
    .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-demo="' + view + '">')
    .replace(/(src|href)="\/(shared|control|display)\//g, '$1="../$2/')
    .replace('<head>', '<head>\n  <script src="../frame.js"></script>')
    .replace('</head>', '  <link rel="stylesheet" href="../frame.css">\n</head>');
  await writeFile(file, html);
}

// Point the copied renderer at the browser-local demo image store.
const renderer = join(output, 'shared', 'widgets.js');
const code = await readFile(renderer, 'utf8');
const mediaLookup = "'/media/widgets/' + encodeURIComponent(widget.mediaId)";
if (!code.includes(mediaLookup)) throw Error('Update the GitHub Pages widget image adapter.');
await writeFile(renderer, code.replace(mediaLookup, 'deskSideDemo.media(widget.mediaId)'));
await writeFile(join(output, '.nojekyll'), '');
console.log('Static demo built at ' + output);
