import React from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartData } from 'chart.js';

interface ChartSectionProps {
  chartData: ChartData<'doughnut'>;
  loading: boolean;
  hasData: boolean;
}

export default function ChartSection({ chartData, loading, hasData }: ChartSectionProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">Expenses by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-64 w-full flex items-center justify-center">
          {loading ? (
            <div className="animate-pulse bg-gray-200 rounded-full h-48 w-48" />
          ) : hasData ? (
            <Doughnut 
              data={chartData} 
              options={{ 
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'bottom' as const,
                  }
                }
              }} 
            />
          ) : (
            <div className="text-gray-400">No expense data</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

