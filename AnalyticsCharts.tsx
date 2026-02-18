
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, Cell, PieChart, Pie
} from 'recharts';
import { CodeMetrics } from '../types';

interface AnalyticsChartsProps {
  metrics: CodeMetrics;
}

const AnalyticsCharts: React.FC<AnalyticsChartsProps> = ({ metrics }) => {
  const performanceData = [
    { name: 'Complexity', value: metrics.cyclomaticComplexity, max: 20 },
    { name: 'LOC', value: metrics.linesOfCode, max: 100 },
    { name: 'Maint. Index', value: metrics.maintainabilityIndex, max: 100 },
  ];

  const speedupValue = parseFloat(metrics.estimatedSpeedup.replace(/[^0-9.]/g, ''));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Complexity & Maintainability */}
      <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-gray-400 mb-6 uppercase tracking-wider">Metrics Comparison</h3>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={performanceData} layout="vertical" margin={{ left: 0, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" stroke="#999" fontSize={12} width={80} />
              <Tooltip 
                cursor={{ fill: 'transparent' }} 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {performanceData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#ef4444' : index === 1 ? '#3b82f6' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Speedup Gauge Simulation */}
      <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center">
        <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">Est. Speedup</h3>
        <div className="relative w-48 h-48 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
                <circle 
                    cx="96" cy="96" r="80" 
                    stroke="currentColor" strokeWidth="12" fill="transparent" 
                    className="text-gray-800"
                />
                <circle 
                    cx="96" cy="96" r="80" 
                    stroke="currentColor" strokeWidth="12" fill="transparent" 
                    strokeDasharray={2 * Math.PI * 80}
                    strokeDashoffset={2 * Math.PI * 80 * (1 - Math.min(speedupValue / 5, 1))}
                    className="text-blue-500"
                    strokeLinecap="round"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold text-white">{metrics.estimatedSpeedup}</span>
                <span className="text-xs text-gray-500">Estimated Gain</span>
            </div>
        </div>
      </div>

      {/* Complexity Breakdown */}
      <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-gray-400 mb-6 uppercase tracking-wider">Complexity Details</h3>
        <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                <span className="text-gray-400 text-sm">Cyclomatic Complexity</span>
                <span className={`font-mono font-bold ${metrics.cyclomaticComplexity > 10 ? 'text-red-400' : 'text-green-400'}`}>
                    {metrics.cyclomaticComplexity}
                </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                <span className="text-gray-400 text-sm">Maintainability Index</span>
                <span className="font-mono font-bold text-blue-400">
                    {metrics.maintainabilityIndex}/100
                </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                <span className="text-gray-400 text-sm">Lines of Code</span>
                <span className="font-mono font-bold text-white">
                    {metrics.linesOfCode}
                </span>
            </div>
            <p className="text-[10px] text-gray-500 mt-4 italic">
                * Complexity calculated based on decision nodes and branching in AST.
            </p>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsCharts;
