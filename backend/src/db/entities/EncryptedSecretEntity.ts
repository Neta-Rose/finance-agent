import { EntitySchema } from "typeorm";

export type EncryptedSecretKind =
  | "telegram_bot_token"
  | "whatsapp_access_token"
  | "whatsapp_app_secret";

export interface EncryptedSecretEntity {
  id: string;
  userId: string;
  secretKind: EncryptedSecretKind;
  ciphertext: Buffer;
  nonce: Buffer;
  keyId: number;
  ciphertextHash: string;
  createdAt: Date;
  rotatedAt: Date | null;
}

export const EncryptedSecretEntitySchema = new EntitySchema<EncryptedSecretEntity>({
  name: "EncryptedSecret",
  tableName: "encrypted_secrets",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    secretKind: { name: "secret_kind", type: "varchar", length: 32 },
    ciphertext: { type: "bytea" },
    nonce: { type: "bytea" },
    keyId: { name: "key_id", type: "integer" },
    ciphertextHash: { name: "ciphertext_hash", type: "char", length: 8 },
    createdAt: { name: "created_at", type: "timestamptz" },
    rotatedAt: { name: "rotated_at", type: "timestamptz", nullable: true },
  },
});
