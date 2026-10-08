// S37 Snapshots: take one, list them, keep the newest N (the rest are exiled, never deleted).
//
// A snapshot is a folder <root>/<YYYY-MM-DD_HH-mm-ss>/ holding
//   agentos.db     a consistent copy made with SQLite's backup API (never a raw copy of a
//                  WAL database: the -wal file would be missing or torn)
//   agentic-os/    the state folder (~/.agentic-os) minus the exclusions in config.ts
//   manifest.json  every copied file with its size and sha256, what was left out and why
//   restore.ps1    puts the snapshot back (stops Agent OS first, moves the current state to
//                  .exile, carries the left-out secrets over from that exiled state)
// It is built under <root>/.partial-<stamp> and renamed into place at the end, so a
// half-written snapshot never counts as one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import DatabaseCtor from "better-sqlite3";
import { ensureDb, dbPath } from "../db";
import { exileFile, exileStamp } from "../../exileFile";
import {
  REDACTED_JSON_FILES,
  exclusionSummary,
  isExcludedRel,
  isSecretRel,
  snapshotRootDir,
  snapshotSettings,
  snapshotSourceDir,
  stripSecretFields,
  type SnapshotSettings,
} from "./config";

export const AGENT_OS_PORT = 3737;
export const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

export interface ManifestFile { path: string; bytes: number; sha256: string }

export interface SnapshotManifest {
  format: 1;
  createdAt: string;
  reason: "schedule" | "manual";
  agentOsVersion: string | null;
  host: string;
  source: { dir: string; db: string; repoRoot: string; port: number };
  includeSecrets: boolean;
  db: ManifestFile;
  /** Every file in the snapshot folder except manifest.json and restore.ps1 (agentos.db included). */
  files: ManifestFile[];
  totalBytes: number;
  /** JSON files kept with their secret fields removed. */
  redacted: { path: string; fields: string[] }[];
  /** Paths (relative to the state folder) left out because they hold secrets. */
  secretsLeftOut: string[];
  /** The exclusion rules in force, as words. */
  excluded: string[];
}

export interface SnapshotSummary {
  name: string;
  dir: string;
  createdAt: string;
  reason: SnapshotManifest["reason"];
  totalBytes: number;
  fileCount: number;
  includeSecrets: boolean;
  secretsLeftOut: number;
  agentOsVersion: string | null;
}

export interface TakeResult {
  snapshot: SnapshotSummary;
  manifest: SnapshotManifest;
  exiled: string[];
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(
    fs.createReadStream(file),
    new Writable({ write(chunk, _enc, cb) { hash.update(chunk); cb(); } }),
  );
  return hash.digest("hex");
}

function agentOsVersion(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The live database files: never copied raw (the backup API makes the consistent copy). */
function liveDbFiles(): Set<string> {
  const db = path.resolve(dbPath());
  return new Set(["", "-wal", "-shm", "-journal"].map((s) => db + s));
}

interface Walked { files: string[]; secretsLeftOut: string[] }

function walk(root: string, includeSecrets: boolean, live: Set<string>, rel = "", acc: Walked = { files: [], secretsLeftOut: [] }): Walked {
  const abs = rel ? path.join(root, rel) : root;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (isExcludedRel(r)) continue;
    if (e.isSymbolicLink()) continue; // never follow links out of the state folder
    if (!includeSecrets && isSecretRel(r)) { acc.secretsLeftOut.push(e.isDirectory() ? `${r}/` : r); continue; }
    if (e.isDirectory()) walk(root, includeSecrets, live, r, acc);
    else if (e.isFile() && !live.has(path.resolve(root, r))) acc.files.push(r);
  }
  return acc;
}

/**
 * Take a snapshot now. Throws (loudly) when the DB cannot be copied or the folder cannot be
 * written; a thrown error leaves only a .partial-* folder behind, which the next retention
 * pass exiles.
 */
export async function takeSnapshot(reason: SnapshotManifest["reason"], settings: SnapshotSettings = snapshotSettings()): Promise<TakeResult> {
  const root = snapshotRootDir(settings);
  const source = snapshotSourceDir();
  const createdAt = new Date();
  const name = exileStamp(createdAt);
  const finalDir = path.join(root, name);
  const workDir = path.join(root, `.partial-${name}`);
  if (fs.existsSync(finalDir)) throw new Error(`snapshots: ${finalDir} already exists (two snapshots in the same second); try again`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1. the database, through the backup API
  const db = ensureDb();
  const dbDest = path.join(workDir, "agentos.db");
  await db.backup(dbDest);
  // The copy inherits the WAL header, so anyone opening it (the restore check, a reader)
  // would grow -wal/-shm sidecars beside it. Switch the COPY to a rollback journal so the
  // snapshot DB is one self-contained file; Agent OS puts it back in WAL mode when it opens
  // it after a restore (db.ts open()).
  { const copy = new DatabaseCtor(dbDest); try { copy.pragma("journal_mode = DELETE"); } finally { copy.close(); } }
  const dbEntry: ManifestFile = { path: "agentos.db", bytes: fs.statSync(dbDest).size, sha256: await sha256File(dbDest) };

  // 2. the state folder
  const files: ManifestFile[] = [dbEntry];
  const redacted: SnapshotManifest["redacted"] = [];
  const walked = fs.existsSync(source) ? walk(source, settings.includeSecrets, liveDbFiles()) : { files: [], secretsLeftOut: [] };
  for (const rel of walked.files) {
    const from = path.join(source, rel);
    const to = path.join(workDir, "agentic-os", rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!settings.includeSecrets && REDACTED_JSON_FILES.includes(rel)) {
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(from, "utf8")); }
      catch {
        walked.secretsLeftOut.push(`${rel} (not valid JSON, so its secret fields could not be removed; left out)`);
        continue;
      }
      const { doc, removed } = stripSecretFields(parsed);
      fs.writeFileSync(to, JSON.stringify(doc, null, 2), "utf8");
      if (removed.length) redacted.push({ path: `agentic-os/${rel}`, fields: removed });
    } else {
      fs.copyFileSync(from, to);
    }
    files.push({ path: `agentic-os/${rel}`, bytes: fs.statSync(to).size, sha256: await sha256File(to) });
  }

  // 3. the manifest and the restore script
  const summary = exclusionSummary(settings.includeSecrets);
  const manifest: SnapshotManifest = {
    format: 1,
    createdAt: createdAt.toISOString(),
    reason,
    agentOsVersion: agentOsVersion(),
    host: os.hostname(),
    source: { dir: source, db: path.resolve(dbPath()), repoRoot: process.cwd(), port: AGENT_OS_PORT },
    includeSecrets: settings.includeSecrets,
    db: dbEntry,
    files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    redacted,
    secretsLeftOut: walked.secretsLeftOut,
    excluded: summary.always.concat(summary.secrets.map((s) => `secret: ${s}`)),
  };
  fs.writeFileSync(path.join(workDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(workDir, "restore.ps1"), buildRestoreScript(manifest), "utf8");
  fs.renameSync(workDir, finalDir);

  // 4. retention: the newest `keep` stay, older ones are exiled (and any stale .partial-*)
  const exiled = await applyRetention(root, settings.keep, name);
  return { snapshot: summarize(finalDir, manifest), manifest, exiled };
}

function summarize(dir: string, m: SnapshotManifest): SnapshotSummary {
  return {
    name: path.basename(dir),
    dir,
    createdAt: m.createdAt,
    reason: m.reason,
    totalBytes: m.totalBytes,
    fileCount: m.files.length,
    includeSecrets: m.includeSecrets,
    secretsLeftOut: m.secretsLeftOut.length,
    agentOsVersion: m.agentOsVersion,
  };
}

/** Every finished snapshot under `root`, newest first. A folder without a manifest is not one. */
export function listSnapshots(root: string): SnapshotSummary[] {
  if (!fs.existsSync(root)) return [];
  const out: SnapshotSummary[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !SNAPSHOT_NAME_RE.test(e.name)) continue;
    const dir = path.join(root, e.name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
      out.push(summarize(dir, m));
    } catch { /* no manifest: not a snapshot */ }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export function readManifest(dir: string): SnapshotManifest {
  return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
}

/**
 * Keep the newest `keep` snapshots; move the rest (and any abandoned .partial-* folder that
 * is not the one being written) to <root>/.exile/<stamp>/. Nothing is deleted. Returns the
 * names moved.
 */
export async function applyRetention(root: string, keep: number, inProgress?: string): Promise<string[]> {
  if (!fs.existsSync(root)) return [];
  const stamp = exileStamp();
  const moved: string[] = [];
  const snaps = listSnapshots(root);
  for (const s of snaps.slice(Math.max(1, keep))) {
    if (await exileFile(s.dir, root, stamp)) moved.push(s.name);
  }
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith(".partial-")) continue;
    if (inProgress && e.name === `.partial-${inProgress}`) continue;
    if (await exileFile(path.join(root, e.name), root, stamp)) moved.push(e.name);
  }
  return moved;
}

/** Exiled snapshots (names only), newest exile batch first. */
export function listExiled(root: string): { stamp: string; names: string[] }[] {
  const ex = path.join(root, ".exile");
  if (!fs.existsSync(ex)) return [];
  return fs
    .readdirSync(ex, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ stamp: e.name, names: fs.readdirSync(path.join(ex, e.name)) }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The restore script written into every snapshot. PowerShell, ASCII only. It refuses to run
 * over a live Agent OS (stops it through the repo's Stop script when that exists), moves the
 * current state folder and database to <snapshot root>/.exile/<stamp>/before-restore/,
 * copies the snapshot in, carries over the secret files the snapshot left out from the
 * exiled state, puts the removed secret fields of settings.json / config.json back from the
 * exiled copies, and checks every file against the manifest's sha256.
 */
export function buildRestoreScript(m: SnapshotManifest): string {
  return [
    "# Agent OS snapshot restore. Generated by Agent OS; see manifest.json beside this file.",
    `# Taken ${m.createdAt} on ${m.host}${m.agentOsVersion ? ` (Agent OS v${m.agentOsVersion})` : ""}.`,
    "# Usage: .\\restore.ps1 [-SourceDir <path>] [-DbPath <path>] [-RepoRoot <path>] [-Port 3737] [-Yes]",
    "# Nothing is deleted: the state this script replaces is moved to <snapshot root>\\.exile\\<stamp>\\before-restore.",
    "param(",
    `  [string]$SourceDir = ${ps(m.source.dir)},`,
    `  [string]$DbPath = ${ps(m.source.db)},`,
    `  [string]$RepoRoot = ${ps(m.source.repoRoot)},`,
    `  [int]$Port = ${m.source.port},`,
    "  [switch]$Yes",
    ")",
    '$ErrorActionPreference = "Stop"',
    "$Here = Split-Path -Parent $MyInvocation.MyCommand.Path",
    '$Manifest = Get-Content -LiteralPath (Join-Path $Here "manifest.json") -Raw | ConvertFrom-Json',
    '$SnapState = Join-Path $Here "agentic-os"',
    '$SnapDb = Join-Path $Here "agentos.db"',
    'Write-Host "Agent OS snapshot restore"',
    'Write-Host "  snapshot : $Here (taken $($Manifest.createdAt))"',
    'Write-Host "  state    : $SourceDir"',
    'Write-Host "  database : $DbPath"',
    "",
    "# 1. Agent OS must not be running while its state is replaced.",
    "function Test-Listening { param([int]$P) if ($P -le 0) { return $false }; return [bool](Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue) }",
    "if (Test-Listening $Port) {",
    '  $Stop = Join-Path $RepoRoot "Stop Agent OS.bat"',
    "  if (Test-Path -LiteralPath $Stop) {",
    '    Write-Host "Agent OS is listening on port $Port; stopping it with $Stop"',
    '    & cmd /c "`"$Stop`""',
    "    Start-Sleep -Seconds 4",
    "  }",
    "  if (Test-Listening $Port) {",
    '    Write-Error "Agent OS is still listening on port $Port. Stop it (Stop Agent OS.bat), then run this script again."',
    "    exit 1",
    "  }",
    "}",
    "",
    "# 2. Confirm.",
    "if (-not $Yes) {",
    '  $Answer = Read-Host "Replace the state in $SourceDir and the database $DbPath with this snapshot? Type yes"',
    '  if ($Answer -ne "yes") { Write-Host "Nothing changed."; exit 1 }',
    "}",
    "",
    "# 3. Move the current state aside (never deleted).",
    '$Stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"',
    '$Exile = Join-Path (Split-Path -Parent $Here) (Join-Path ".exile" (Join-Path $Stamp "before-restore"))',
    "New-Item -ItemType Directory -Force -Path $Exile | Out-Null",
    '$OldState = Join-Path $Exile "agentic-os"',
    "if (Test-Path -LiteralPath $SourceDir) {",
    "  Move-Item -LiteralPath $SourceDir -Destination $OldState",
    '  Write-Host "moved current state to $OldState"',
    "}",
    '$OldDb = Join-Path $Exile "db"',
    'foreach ($Suffix in @("", "-wal", "-shm", "-journal")) {',
    '  $F = "$DbPath$Suffix"',
    "  if (Test-Path -LiteralPath $F) {",
    "    New-Item -ItemType Directory -Force -Path $OldDb | Out-Null",
    "    Move-Item -LiteralPath $F -Destination (Join-Path $OldDb (Split-Path -Leaf $F))",
    '    Write-Host "moved current database file $F"',
    "  }",
    "}",
    "",
    "# 4. Put the snapshot in place.",
    "if (Test-Path -LiteralPath $SnapState) { Copy-Item -LiteralPath $SnapState -Destination $SourceDir -Recurse } else { New-Item -ItemType Directory -Force -Path $SourceDir | Out-Null }",
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DbPath) | Out-Null",
    "Copy-Item -LiteralPath $SnapDb -Destination $DbPath",
    "",
    "# 5. Secrets this snapshot left out: carry the current ones over from the exiled state.",
    "$Carried = 0",
    "foreach ($Rel in @($Manifest.secretsLeftOut)) {",
    '  if ($Rel -match " \\(") { continue }',
    '  $Clean = $Rel.TrimEnd("/")',
    '  $From = Join-Path $OldState ($Clean -replace "/", "\\")',
    "  if (Test-Path -LiteralPath $From) {",
    '    $To = Join-Path $SourceDir ($Clean -replace "/", "\\")',
    "    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $To) | Out-Null",
    "    Copy-Item -LiteralPath $From -Destination $To -Recurse -Force",
    "    $Carried++",
    "  }",
    "}",
    'if ($Carried -gt 0) { Write-Host "kept $Carried current secret file(s) the snapshot left out" }',
    "",
    "# 6. Secret fields removed from settings.json / config.json: put them back from the exiled copies.",
    "function Get-Field($Obj, [string[]]$Parts) { foreach ($P in $Parts) { if ($null -eq $Obj) { return $null }; $Obj = $Obj.$P }; return $Obj }",
    "function Set-Field($Obj, [string[]]$Parts, $Value) {",
    "  for ($I = 0; $I -lt $Parts.Length - 1; $I++) {",
    "    $P = $Parts[$I]",
    "    if ($null -eq $Obj.PSObject.Properties[$P] -or $null -eq $Obj.$P) { $Obj | Add-Member -NotePropertyName $P -NotePropertyValue ([pscustomobject]@{}) -Force }",
    "    $Obj = $Obj.$P",
    "  }",
    "  $Leaf = $Parts[-1]",
    "  if ($null -eq $Obj.PSObject.Properties[$Leaf]) { $Obj | Add-Member -NotePropertyName $Leaf -NotePropertyValue $Value } else { $Obj.$Leaf = $Value }",
    "}",
    "foreach ($R in @($Manifest.redacted)) {",
    '  $Rel = ($R.path -replace "^agentic-os/", "") -replace "/", "\\"',
    "  $OldFile = Join-Path $OldState $Rel",
    "  $NewFile = Join-Path $SourceDir $Rel",
    "  if (-not (Test-Path -LiteralPath $OldFile) -or -not (Test-Path -LiteralPath $NewFile)) { continue }",
    "  try {",
    "    $OldDoc = Get-Content -LiteralPath $OldFile -Raw | ConvertFrom-Json",
    "    $NewDoc = Get-Content -LiteralPath $NewFile -Raw | ConvertFrom-Json",
    "    $Put = 0",
    "    foreach ($Field in @($R.fields)) {",
    '      $Parts = $Field -split "\\."',
    "      $V = Get-Field $OldDoc $Parts",
    "      if ($null -ne $V) { Set-Field $NewDoc $Parts $V; $Put++ }",
    "    }",
    "    if ($Put -gt 0) {",
    "      $NewDoc | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $NewFile -Encoding UTF8",
    '      Write-Host "put $Put secret field(s) back into $Rel from the current file"',
    "    }",
    '  } catch { Write-Warning "could not merge secret fields into ${Rel}: $_" }',
    "}",
    "",
    "# 7. Check every restored file against the manifest.",
    "$Bad = 0",
    "foreach ($F in @($Manifest.files)) {",
    '  if ($F.path -eq "agentos.db") { $Target = $DbPath } else { $Target = Join-Path $SourceDir (($F.path -replace "^agentic-os/", "") -replace "/", "\\") }',
    '  if (-not (Test-Path -LiteralPath $Target)) { Write-Warning "missing after restore: $($F.path)"; $Bad++; continue }',
    "  $Hash = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()",
    '  if ($Hash -ne $F.sha256 -and -not (@($Manifest.redacted | ForEach-Object { $_.path }) -contains $F.path)) { Write-Warning "hash differs after restore: $($F.path)"; $Bad++ }',
    "}",
    'if ($Bad -gt 0) { Write-Error "$Bad file(s) did not restore cleanly. The previous state is intact in $Exile."; exit 2 }',
    'Write-Host "Restored $($Manifest.files.Count) files. The previous state is in $Exile (nothing was deleted). Start Agent OS again."',
    "exit 0",
    "",
  ].join("\r\n");
}
