import { EntitySchema } from "typeorm";

export interface UserPointsBudgetEntity {
  userId: string;
  dailyBudgetPoints: string;
  createdAt: Date;
  updatedAt: Date;
}

export const UserPointsBudgetEntitySchema = new EntitySchema<UserPointsBudgetEntity>({
  name: "UserPointsBudget",
  tableName: "user_points_budgets",
  columns: {
    userId: {
      name: "user_id",
      type: "varchar",
      primary: true,
    },
    dailyBudgetPoints: {
      name: "daily_budget_points",
      type: "numeric",
      precision: 18,
      scale: 6,
    },
    createdAt: {
      name: "created_at",
      type: "timestamptz",
    },
    updatedAt: {
      name: "updated_at",
      type: "timestamptz",
    },
  },
});
