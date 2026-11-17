export type WorkspaceCollectionName =
  | 'codeProjects'
  | 'websiteProjects'
  | 'documents'
  | 'datasets'
  | 'activityLogs';

export const WORKSPACE_COLLECTIONS: WorkspaceCollectionName[] = [
  'codeProjects',
  'websiteProjects',
  'documents',
  'datasets',
  'activityLogs',
];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OwnedWorkspaceRecord {
  id: string;
  ownerId: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: any;
}

export interface MigrationResult {
  guestUid: string;
  targetUid: string;
  migratedCount: number;
  skippedAlreadyMigratedCount: number;
  skippedForeignOwnerCount: number;
  failedCount: number;
  migratedByCollection: Record<WorkspaceCollectionName, string[]>;
  errors: Array<{ collection: WorkspaceCollectionName; id: string; error: string }>;
}

function getCollectionStorageKey(col: WorkspaceCollectionName, uid: string): string {
  return `ws_${col}_${uid}`;
}

function getMigrationLedgerKey(guestUid: string, targetUid: string): string {
  return `ws_migration_ledger_${guestUid}_to_${targetUid}`;
}

function readJsonArray<T>(storage: StorageLike, key: string): T[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(storage: StorageLike, key: string, items: T[]): void {
  storage.setItem(key, JSON.stringify(items));
}

/**
 * Safely migrates guest-created workspace records to an authenticated user account.
 *
 * Security & Reliability Guarantees:
 * 1. Only migrates records whose `ownerId === guestUid` (foreign records are untouched).
 * 2. Maintains an idempotent ledger (`ws_migration_ledger_<guestUid>_to_<targetUid>`) so
 *    retries or interrupted migrations never create duplicate records.
 * 3. Only removes a record from the guest store AFTER `persistTargetRecord` succeeds,
 *    preserving remaining guest items if a partial failure occurs mid-migration.
 */
export async function migrateGuestToAuthenticatedAccount(params: {
  guestUid: string;
  targetUid: string;
  storage: StorageLike;
  persistTargetRecord?: (
    col: WorkspaceCollectionName,
    migratedRecord: OwnedWorkspaceRecord
  ) => Promise<void>;
}): Promise<MigrationResult> {
  const { guestUid, targetUid, storage, persistTargetRecord } = params;

  const result: MigrationResult = {
    guestUid,
    targetUid,
    migratedCount: 0,
    skippedAlreadyMigratedCount: 0,
    skippedForeignOwnerCount: 0,
    failedCount: 0,
    migratedByCollection: {
      codeProjects: [],
      websiteProjects: [],
      documents: [],
      datasets: [],
      activityLogs: [],
    },
    errors: [],
  };

  if (!guestUid || !targetUid || guestUid === targetUid) {
    return result;
  }

  const ledgerKey = getMigrationLedgerKey(guestUid, targetUid);
  const migratedIds = new Set<string>(readJsonArray<string>(storage, ledgerKey));

  for (const col of WORKSPACE_COLLECTIONS) {
    const guestKey = getCollectionStorageKey(col, guestUid);
    const targetKey = getCollectionStorageKey(col, targetUid);

    const guestItems = readJsonArray<OwnedWorkspaceRecord>(storage, guestKey);
    if (guestItems.length === 0) continue;

    const targetItems = readJsonArray<OwnedWorkspaceRecord>(storage, targetKey);
    const targetIds = new Set(targetItems.map((item) => item.id));
    const remainingGuestItems: OwnedWorkspaceRecord[] = [];

    for (const item of guestItems) {
      if (!item || typeof item.id !== 'string') {
        continue;
      }

      // 1. Strict ownership verification: never claim records not owned by guestUid
      if (item.ownerId !== guestUid) {
        result.skippedForeignOwnerCount += 1;
        remainingGuestItems.push(item);
        continue;
      }

      const ledgerEntryId = `${col}:${item.id}`;

      // 2. Idempotency check: if already migrated in ledger or already present in target store
      if (migratedIds.has(ledgerEntryId) || targetIds.has(item.id)) {
        result.skippedAlreadyMigratedCount += 1;
        migratedIds.add(ledgerEntryId);
        // Safe to omit from remainingGuestItems since it is already in target
        continue;
      }

      // 3. Prepare ownership-transferred record
      const now = new Date().toISOString();
      const transferredRecord: OwnedWorkspaceRecord = {
        ...item,
        ownerId: targetUid,
        migratedFromGuestId: guestUid,
        migratedAt: now,
        updatedAt: item.updatedAt || now,
      };

      try {
        if (persistTargetRecord) {
          await persistTargetRecord(col, transferredRecord);
        }

        // Also update the target user's local storage mirror atomically
        const latestTargetItems = readJsonArray<OwnedWorkspaceRecord>(storage, targetKey).filter(
          (existing) => existing.id !== transferredRecord.id
        );
        latestTargetItems.unshift(transferredRecord);
        writeJsonArray(storage, targetKey, latestTargetItems);

        targetIds.add(transferredRecord.id);
        migratedIds.add(ledgerEntryId);
        writeJsonArray(storage, ledgerKey, Array.from(migratedIds));

        result.migratedCount += 1;
        result.migratedByCollection[col].push(transferredRecord.id);
      } catch (err: any) {
        // Keep item in guest storage so retry can recover without data loss
        result.failedCount += 1;
        result.errors.push({
          collection: col,
          id: item.id,
          error: err instanceof Error ? err.message : String(err),
        });
        remainingGuestItems.push(item);
      }
    }

    if (remainingGuestItems.length === 0) {
      storage.removeItem(guestKey);
    } else {
      writeJsonArray(storage, guestKey, remainingGuestItems);
    }
  }

  return result;
}
