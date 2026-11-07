import { mkdir, copyFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(`${root}/dist`, { recursive: true });
for (const file of ['index.html', 'README.md']) await copyFile(`${root}/${file}`, `${root}/dist/${file}`);
for (const dir of ['src', 'public', 'labs', 'docs']) await cp(`${root}/${dir}`, `${root}/dist/${dir}`, { recursive: true });
console.log('Build estático concluído em dist/. Sem dependências ou recursos externos.');
