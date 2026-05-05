import { EntitySchema } from "typeorm";

export interface MigrationArchiveEntity {
  id: string;
  userId: string;
  sourcePath: string;
  reason: string;
  payload: unknown;
  archivedAt: Date;
}

export const MigrationArchiveEntitySchema = new EntitySchema<MigrationArchiveEntity>({
  name: "MigrationArchive",
  tableName: "migration_archive",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    sourcePath: { name: "source_path", type: "varchar", length: 512 },
    reason: { type: "varchar", length: 64 },
    payload: { type: "jsonb" },
    archivedAt: { name: "archived_at", type: "timestamptz" },
  },
});
