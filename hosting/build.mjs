import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';

const web = new URL('../web/', import.meta.url);
const hosting = new URL('./', import.meta.url);
const source = (file, encoding) => readFile(new URL(file, hosting), encoding);
const types = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  webp: 'image/webp',
};
const hostedCopy = {
  'index.html': ['DEMONSTRADOR LOCAL', 'DEMONSTRADOR WEB'],
  'panels.js': [
    'Você pode revisar a sessão e registrar uma observação neste computador.',
    'Você pode revisar a sessão e registrar uma observação fictícia.',
  ],
};

const assets = {};
for (const file of (await readdir(web)).sort()) {
  const type = types[file.split('.').at(-1)];
  if (!type) throw new Error('Tipo de arquivo inesperado: ' + file);
  let bytes = await readFile(new URL(file, web));
  if (Object.hasOwn(hostedCopy, file)) {
    bytes = Buffer.from(bytes.toString('utf8').replace(...hostedCopy[file]));
  }
  assets[file === 'index.html' ? '/' : '/' + file] = [type, bytes.toString('base64')];
}

const fixtures = await source('worker/fixtures.json', 'utf8');
const modules = await Promise.all(['mission', 'environment', 'server'].map(name => source('worker/' + name + '.js', 'utf8')));
await mkdir(new URL('dist/server/', hosting), { recursive: true });
await writeFile(new URL('dist/server/index.js', hosting),
  'const assets=' + JSON.stringify(assets) + ';\nconst fixtures=' + fixtures + ';\n' + modules.join('\n'));

const config = await source('.openai/hosting.json').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (config) {
  await mkdir(new URL('dist/.openai/', hosting), { recursive: true });
  await writeFile(new URL('dist/.openai/hosting.json', hosting), config);
}

