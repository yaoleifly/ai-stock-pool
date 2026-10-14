import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const files = [
  "index.html",
  "app.js",
  "styles.css",
  "brand.svg",
  "research-bridge.js",
  "stock-pool.csv",
  "discovery-candidates.csv",
  "discovery-signals.csv",
  "arxiv-papers.csv",
  "discovery-history.csv",
  "discovery-status.json",
  "tpi-latest.json",
  "institutional-crowding-history.json",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}

await cp(resolve(root, "reports"), resolve(output, "reports"), { recursive: true });
// 第三方库放在自己站上（不在运行时依赖 unpkg 等公共 CDN）；文件名带版本号，升级时换文件名
await cp(resolve(root, "vendor"), resolve(output, "vendor"), { recursive: true });

// app.js / styles.css 加内容指纹：文件一改网址就变，所以可以让浏览器长期缓存
const sha = (buf, enc = "hex") => createHash("sha256").update(buf).digest(enc);
let html = await readFile(resolve(output, "index.html"), "utf8");
for (const asset of ["app.js", "styles.css"]) {
  const version = sha(await readFile(resolve(output, asset))).slice(0, 10);
  html = html.replace(new RegExp(`(["'])${asset.replace(".", "\\.")}(\\?v=[^"']*)?\\1`, "g"), (_, q) => `${q}${asset}?v=${version}${q}`);
}
await writeFile(resolve(output, "index.html"), html);

// 安全响应头（静态文件；/api/* 由 Worker 自己加）
const inlineHashes = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/.test(m[1] || "") && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1] || "") && m[2].trim())
  .map((m) => `'sha256-${sha(m[2], "base64")}'`);
const csp = [
  "default-src 'self'",
  `script-src 'self' https://static.cloudflareinsights.com ${inlineHashes.join(" ")}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");
const LONG = "public, max-age=31536000, immutable";
const headers = `# 由 scripts/build-static.mjs 生成
/*
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: ${csp}
/vendor/*
  Cache-Control: ${LONG}
/app.js
  Cache-Control: ${LONG}
/styles.css
  Cache-Control: ${LONG}
/brand.svg
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
`;
await writeFile(resolve(output, "_headers"), headers);

console.log(`Built Cloudflare static bundle: ${files.length} files + reports/ + vendor/, _headers written`);
