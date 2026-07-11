import fs from 'fs';
import path from 'path';

export interface StoredApprovalRecord {
  id: string;
}

export interface HitlApprovalStorageStatus {
  backend: 'file';
  configured: true;
  singleInstanceOnly: true;
  path: string;
  healthy: boolean;
  error?: string;
}

function defaultApprovalFilePath(): string {
  if (process.env.MORGAN_HITL_APPROVAL_FILE) return path.resolve(process.env.MORGAN_HITL_APPROVAL_FILE);
  const home = process.env.HOME || process.env.USERPROFILE;
  const root = home ? path.join(home, 'data') : path.join(process.cwd(), '.morgan-state');
  return path.join(root, 'hitl-approvals.json');
}

function parseRecords(value: unknown): StoredApprovalRecord[] {
  if (!Array.isArray(value)) throw new Error('HITL approval store must contain a JSON array.');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof (item as StoredApprovalRecord).id !== 'string') {
      throw new Error('HITL approval store contains an invalid record.');
    }
    return item as StoredApprovalRecord;
  });
}

export class FileHitlApprovalStorage {
  readonly backend = 'file' as const;
  readonly singleInstanceOnly = true as const;
  private locked = false;

  constructor(private readonly filePath = defaultApprovalFilePath()) {}

  get path(): string {
    return this.filePath;
  }

  private acquire(): void {
    if (this.locked) throw new Error('Concurrent HITL approval update rejected; retry the decision.');
    this.locked = true;
  }

  private release(): void {
    this.locked = false;
  }

  load(): StoredApprovalRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (!raw.trim()) throw new Error('HITL approval store is empty or corrupt.');
    return parseRecords(JSON.parse(raw) as unknown);
  }

  save(records: StoredApprovalRecord[]): void {
    this.acquire();
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      const fd = fs.openSync(temporary, 'w', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(records, null, 2), 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.filePath);
    } finally {
      this.release();
    }
  }

  status(): HitlApprovalStorageStatus {
    try {
      if (fs.existsSync(this.filePath)) this.load();
      return {
        backend: this.backend,
        configured: true,
        singleInstanceOnly: this.singleInstanceOnly,
        path: this.filePath,
        healthy: true,
      };
    } catch (error) {
      return {
        backend: this.backend,
        configured: true,
        singleInstanceOnly: this.singleInstanceOnly,
        path: this.filePath,
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

let approvalStorage = new FileHitlApprovalStorage();

export function getHitlApprovalStorage(): FileHitlApprovalStorage {
  return approvalStorage;
}

export function configureHitlApprovalStorageForTests(filePath: string): void {
  approvalStorage = new FileHitlApprovalStorage(filePath);
}

export function getHitlApprovalStorageStatus(): HitlApprovalStorageStatus {
  return approvalStorage.status();
}
