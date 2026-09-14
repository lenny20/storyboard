import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStoryboardPdf } from '../lib/pdf/export.ts';

const [sourceDirectory, sceneId, outputDirectory] = process.argv.slice(2);
if (!sourceDirectory || !sceneId || !outputDirectory) {
  throw new Error(
    'Usage: node --import tsx tests/render-project-review-pdfs.mjs <snapshot folder> <scene id> <output folder>',
  );
}
const manifest = JSON.parse(
  await readFile(path.join(sourceDirectory, 'project.storyboard.json'), 'utf8'),
);
const project = manifest.project;
const scene = project.scenes.find((entry) => entry.id === sceneId);
if (!scene)
  throw new Error('The requested scene is absent from the review snapshot.');
for (const shot of scene.shots) {
  for (const panel of shot.panels) {
    const version = panel.versions.find(
      (entry) => entry.id === panel.selectedVersionId,
    );
    if (!version?.dataUrl.startsWith('asset:sha256:')) continue;
    const filename = version.dataUrl.slice('asset:sha256:'.length);
    if (!/^[a-f0-9]{64}\.(png|jpg|webp|gif|avif)$/.test(filename)) {
      throw new Error('Invalid review asset token.');
    }
    const extension = filename.split('.').at(-1);
    const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    const bytes = await readFile(
      path.join(sourceDirectory, 'images', filename),
    );
    version.dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  }
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url =
    input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
  return url.protocol === 'file:'
    ? new Response(await readFile(fileURLToPath(url)), { status: 200 })
    : nativeFetch(input, init);
};
await mkdir(outputDirectory, { recursive: true });
for (const layout of ['portrait-2up', 'landscape-2up', 'landscape-3up']) {
  const bytes = await createStoryboardPdf(project, { sceneId, layout });
  const output = path.join(outputDirectory, `${layout}.pdf`);
  await writeFile(output, bytes);
  console.log(`${layout}: ${bytes.length} bytes`);
}
