interface ChartData {
  labels: string[];
  data: number[];
}

export function generatePieChartUrl(chartData: ChartData): string {
  if (chartData.data.length === 0) return '';

  const chartConfig = {
    type: 'pie',
    data: {
      labels: chartData.labels,
      datasets: [{
        data: chartData.data,
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF'
        ]
      }]
    },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            font: { size: 10 }
          }
        },
        datalabels: {
          display: true,
          color: '#fff',
          formatter: (value: any) => {
            return value > 0 ? value : '';
          }
        }
      }
    }
  };

  const baseUrl = 'https://quickchart.io/chart';
  const jsonConfig = JSON.stringify(chartConfig);
  return `${baseUrl}?c=${encodeURIComponent(jsonConfig)}&w=500&h=300`;
}

