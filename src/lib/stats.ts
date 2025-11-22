import mongoose from 'mongoose';
import Transaction from '@/models/Transaction';
import { QueryData } from '@/lib/ai';

export interface StatsResult {
  totalExpense: number;
  totalIncome: number;
  breakdown: { _id: string; total: number }[];
  transactionCount: number;
}

export interface TransactionDetail {
  item: string;
  amount: number;
  category: string;
  date: Date;
  type: 'expense' | 'income';
}

export interface TopExpenseResult {
  topCategory: { category: string; total: number } | null;
  topItem: { item: string; amount: number; date: Date } | null;
}

export async function getTransactionStats(
  userId: string,
  query: QueryData
): Promise<StatsResult> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const matchStage: any = {
    userId,
    date: { $gte: start, $lte: end },
  };

  if (query.category) {
    matchStage.category = query.category;
  }

  const totals = await Transaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  let totalExpense = 0;
  let totalIncome = 0;
  let transactionCount = 0;

  totals.forEach((t) => {
    if (t._id === 'expense') totalExpense = t.total;
    if (t._id === 'income') totalIncome = t.total;
    transactionCount += t.count;
  });

  const breakdown = await Transaction.aggregate([
    { 
      $match: { 
        ...matchStage, 
        type: 'expense' 
      } 
    },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
      },
    },
    { $sort: { total: -1 } },
  ]);

  return {
    totalExpense,
    totalIncome,
    breakdown,
    transactionCount,
  };
}

export async function getTransactionList(
  userId: string,
  query: QueryData
): Promise<TransactionDetail[]> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const filter: any = {
    userId,
    date: { $gte: start, $lte: end },
  };

  if (query.category) {
    filter.category = query.category;
  }

  const transactions = await Transaction.find(filter)
    .sort({ date: -1 }) // Newest first
    .limit(20); // Limit to avoid hitting Line message size limits

  return transactions.map(t => ({
    item: t.item,
    amount: t.amount,
    category: t.category,
    date: t.date,
    type: t.type
  }));
}

export async function getTopExpense(
  userId: string,
  query: QueryData
): Promise<TopExpenseResult> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const matchStage = {
    userId,
    type: 'expense',
    date: { $gte: start, $lte: end },
  };

  // Top Category
  const categoryStats = await Transaction.aggregate([
    { $match: matchStage },
    { $group: { _id: '$category', total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
    { $limit: 1 }
  ]);

  // Top Single Item
  const itemStats = await Transaction.find(matchStage)
    .sort({ amount: -1 })
    .limit(1);

  return {
    topCategory: categoryStats.length > 0 ? { category: categoryStats[0]._id, total: categoryStats[0].total } : null,
    topItem: itemStats.length > 0 ? { item: itemStats[0].item, amount: itemStats[0].amount, date: itemStats[0].date } : null
  };
}
