/**
 * Minimal append-to-file + stdout logger shared by the pipeline CLIs.
 * Every batch (count generated, validation pass/fail, dedup hits) gets a
 * line here so a resumed/crashed run has an audit trail on disk, not just
 * whatever scrolled past in the terminal.
 */

import fs from "node:fs";
import path from "node:path";

export class Logger {
  private logFile: string;

  constructor(logFile: string) {
    this.logFile = logFile;
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  }

  log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    fs.appendFileSync(this.logFile, line + "\n", "utf-8");
  }

  warn(message: string): void {
    const line = `[${new Date().toISOString()}] WARN ${message}`;
    console.warn(line);
    fs.appendFileSync(this.logFile, line + "\n", "utf-8");
  }

  error(message: string): void {
    const line = `[${new Date().toISOString()}] ERROR ${message}`;
    console.error(line);
    fs.appendFileSync(this.logFile, line + "\n", "utf-8");
  }
}
