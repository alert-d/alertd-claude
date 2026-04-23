#!/usr/bin/env bun
/**
 * Build alertd-mcp binaries for all platforms and zip them for distribution.
 *
 * Output:
 *   dist/mcp/alertd-mcp-macos-arm64      + .zip
 *   dist/mcp/alertd-mcp-macos-x64        + .zip
 *   dist/mcp/alertd-mcp-linux-x64        + .zip
 *   dist/mcp/alertd-mcp-linux-arm64      + .zip
 *   dist/mcp/alertd-mcp-windows-x64.exe  + .zip
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ENTRY = './cli.ts';
const OUT_DIR = 'dist/mcp';

const TARGETS = [
    { target: 'bun-darwin-arm64', name: 'alertd-mcp-macos-arm64' },
    { target: 'bun-darwin-x64',   name: 'alertd-mcp-macos-x64' },
    { target: 'bun-linux-x64',    name: 'alertd-mcp-linux-x64' },
    { target: 'bun-linux-arm64',  name: 'alertd-mcp-linux-arm64' },
    { target: 'bun-windows-x64',  name: 'alertd-mcp-windows-x64.exe' },
];

function run(cmd: string, args: string[]): boolean {
    const result = spawnSync(cmd, args, { stdio: 'inherit' });
    return result.status === 0;
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

let built = 0;
let failed = 0;

for (const { target, name } of TARGETS) {
    const outfile = join(OUT_DIR, name);
    const zip = `${outfile}.zip`;

    process.stdout.write(`Building ${name}... `);

    const ok = run('bun', [
        'build', '--compile',
        `--target=${target}`,
        `--outfile=${outfile}`,
        ENTRY,
    ]);

    if (!ok) {
        console.log('FAILED');
        failed++;
        continue;
    }

    // Zip: just the binary, no directory prefix
    const basename = name;
    run('zip', ['-j', zip, outfile]);

    console.log(`done → ${zip}`);
    built++;
}

console.log(`\n${built} built, ${failed} failed.`);
if (failed > 0) process.exit(1);
