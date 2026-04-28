declare namespace NodeJS {
  interface Process {
    pid: number;
    stdout: { columns?: number; rows?: number };
  }
}

declare const process: NodeJS.Process;

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: unknown): void;
  export function mkdtempSync(path: string): string;
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string, options?: unknown): unknown[];
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(path: string, options?: unknown): void;
  export function unlinkSync(path: string): void;
  export function writeFileSync(path: string, content: string, encoding: string): void;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:test" {
  const test: any;
  export default test;
}

declare module "@mariozechner/pi-coding-agent" {
  export interface Theme {
    [key: string]: any;
  }

  export interface ExtensionContext {
    hasUI: boolean;
    cwd: string;
    sessionManager: {
      getEntries(): unknown[];
    };
    ui: {
      notify(message: string, level?: "info" | "warning" | "error"): void;
      custom<T>(...args: any[]): Promise<T>;
    };
    getSystemPrompt(): string;
  }

  export interface ExtensionCommandContext extends ExtensionContext {
    reload(): Promise<void>;
  }

  export interface ExtensionAPI {
    registerCommand(name: string, options: { description: string; handler: (...args: any[]) => Promise<void> | void }): void;
    sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
  }

  export function getAgentDir(): string;
  export function getSettingsListTheme(theme?: Theme): any;
}

declare module "@mariozechner/pi-tui" {
  export type SettingItem = any;

  export class Box {
    [key: string]: any;
    constructor(...args: any[]);
  }

  export class Container {
    [key: string]: any;
    constructor(...args: any[]);
  }

  export class Input {
    focused: boolean;
    onSubmit?: (value: string) => void;
    onEscape?: () => void;
    constructor(...args: any[]);
    setValue(value: string): void;
    render(width: number): string[];
    handleInput(data: string): void;
  }

  export class SettingsList {
    [key: string]: any;
    constructor(...args: any[]);
    handleInput(data: string): void;
    updateValue(id: string, value: string): void;
  }

  export class Spacer {
    [key: string]: any;
    constructor(...args: any[]);
  }

  export class Text {
    [key: string]: any;
    constructor(...args: any[]);
  }

  export function matchesKey(data: string, key: string): boolean;
  export function truncateToWidth(text: string, width: number, ellipsis?: string, trimWhitespace?: boolean): string;
  export function visibleWidth(text: string): number;
}
