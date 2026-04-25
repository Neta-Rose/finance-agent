import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

export interface UserPointsBudgetRecord {
  userId: string;
  dailyBudgetPoints: number;
}

export interface BudgetStore {
  getUserPointsBudget(userId: string): Promise<UserPointsBudgetRecord | null>;
  upsertUserPointsBudget(userId: string, dailyBudgetPoints: number): Promise<UserPointsBudgetRecord>;
}

function rowToPointsBudget(row: Record<string, unknown>): UserPointsBudgetRecord {
  return {
    userId: String(row["user_id"] ?? ""),
    dailyBudgetPoints: Number(row["daily_budget_points"] ?? 0),
  };
}

class PostgresBudgetStore implements BudgetStore {
  async getUserPointsBudget(userId: string): Promise<UserPointsBudgetRecord | null> {
    if (!isApplicationDatabaseConfigured()) return null;
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT user_id, daily_budget_points
         FROM user_points_budgets
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    ) as Array<Record<string, unknown>>;
    return rows[0] ? rowToPointsBudget(rows[0]) : null;
  }

  async upsertUserPointsBudget(userId: string, dailyBudgetPoints: number): Promise<UserPointsBudgetRecord> {
    if (!isApplicationDatabaseConfigured()) {
      return { userId, dailyBudgetPoints };
    }
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `INSERT INTO user_points_budgets (
         user_id,
         daily_budget_points,
         created_at,
         updated_at
       ) VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         daily_budget_points = EXCLUDED.daily_budget_points,
         updated_at = NOW()
       RETURNING user_id, daily_budget_points`,
      [userId, dailyBudgetPoints]
    ) as Array<Record<string, unknown>>;

    return rowToPointsBudget(rows[0] ?? { user_id: userId, daily_budget_points: dailyBudgetPoints });
  }
}

export const budgetStore: BudgetStore = new PostgresBudgetStore();
