import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function buildAssets() {
  return {
    name: 'profile-and-compress-assets',
    writeBundle(options, bundle) {
      const out = resolve(options.dir || 'dist');
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const report = chunks.map((chunk) => {
        const packages = {};
        for (const [id, module] of Object.entries(chunk.modules)) {
          const match = id.replaceAll('\\', '/').match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)/);
          const name = match?.[1] || 'application';
          packages[name] = (packages[name] || 0) + (module.renderedLength || 0);
        }
        return { file: chunk.fileName, entry: chunk.isEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports,
          bytes: Buffer.byteLength(chunk.code), gzip: gzipSync(chunk.code).length,
          packages: Object.fromEntries(Object.entries(packages).sort((a,b) => b[1]-a[1])) };
      });
      mkdirSync(resolve('performance'), { recursive: true });
      writeFileSync(resolve('performance/bundle-current.json'), JSON.stringify(report, null, 2) + '\n');
      for (const item of Object.values(bundle)) {
        if (!/\.(?:js|mjs|css|html|svg)$/.test(item.fileName)) continue;
        const source = item.type === 'chunk' ? item.code : item.source;
        writeFileSync(resolve(out, item.fileName + '.gz'), gzipSync(source));
        writeFileSync(resolve(out, item.fileName + '.br'), brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }));
      }
    },
  };
}
