import { EntitySchema } from "typeorm";

export interface ConcentrationEntry {
  key: string;
  pct: number;
}

export interface PortfolioRiskSnapshotEntity {
  id: string;
  userId: string;
  snapshotAt: Date;
  totalValueIls: string;
  concentrationBySingleNamePct: ConcentrationEntry[];
  concentrationBySectorPct: ConcentrationEntry[];
  concentrationByCurrencyPct: ConcentrationEntry[];
  concentrationByAssetClassPct: ConcentrationEntry[];
  largestSinglePositionTicker: string | null;
  largestSinglePositionPct: string | null;
}

export const PortfolioRiskSnapshotEntitySchema = new EntitySchema<PortfolioRiskSnapshotEntity>({
  name: "PortfolioRiskSnapshot",
  tableName: "portfolio_risk_snapshots",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    snapshotAt: { name: "snapshot_at", type: "timestamptz" },
    totalValueIls: { name: "total_value_ils", type: "numeric", precision: 18, scale: 2 },
    concentrationBySingleNamePct: { name: "concentration_by_single_name_pct", type: "jsonb" },
    concentrationBySectorPct: { name: "concentration_by_sector_pct", type: "jsonb" },
    concentrationByCurrencyPct: { name: "concentration_by_currency_pct", type: "jsonb" },
    concentrationByAssetClassPct: { name: "concentration_by_asset_class_pct", type: "jsonb" },
    largestSinglePositionTicker: {
      name: "largest_single_position_ticker",
      type: "varchar",
      length: 32,
      nullable: true,
    },
    largestSinglePositionPct: {
      name: "largest_single_position_pct",
      type: "numeric",
      precision: 7,
      scale: 4,
      nullable: true,
    },
  },
});
