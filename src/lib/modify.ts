import mongoose from 'mongoose';
import Transaction from '@/models/Transaction';
import { ModificationData } from '@/lib/ai';

export async function modifyTransaction(
  userId: string,
  mod: ModificationData
): Promise<string> {
  // Find the latest transactions to target
  // We sort by createdAt desc
  const limit = (mod.indexOffset || 0) + 1;
  const transactions = await Transaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit);

  if (transactions.length === 0 || transactions.length < limit) {
    return '找不到可操作的交易紀錄。';
  }

  const targetTx = transactions[limit - 1];

  if (mod.action === 'DELETE') {
    await Transaction.findByIdAndDelete(targetTx._id);
    return `已刪除：${targetTx.item} $${targetTx.amount}`;
  } else if (mod.action === 'UPDATE') {
    // Update fields if provided
    if (mod.newAmount) targetTx.amount = mod.newAmount;
    if (mod.newItem) targetTx.item = mod.newItem;
    if (mod.newCategory) targetTx.category = mod.newCategory;
    
    await targetTx.save();
    return `已更新為：${targetTx.item} $${targetTx.amount} (${targetTx.category})`;
  }

  return '未知的操作指令。';
}

