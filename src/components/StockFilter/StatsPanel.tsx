import { BarChart3, TrendingUp, AlertTriangle, Award, Target, Activity } from 'lucide-react';
import { cn } from '@/lib/format';
import type { SelectorStock } from '@/strategies/quantSelector';

interface StatsPanelProps {
  stocks: SelectorStock[];
}

interface Stats {
  totalCount: number;
  avgScore: number;
  avgAdjustedScore: number;
  aCount: number;
  bCount: number;
  cCount: number;
  dCount: number;
  sCount: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
}

function calculateStats(stocks: SelectorStock[]): Stats {
  if (stocks.length === 0) {
    return {
      totalCount: 0,
      avgScore: 0,
      avgAdjustedScore: 0,
      aCount: 0,
      bCount: 0,
      cCount: 0,
      dCount: 0,
      sCount: 0,
      lowRiskCount: 0,
      mediumRiskCount: 0,
      highRiskCount: 0,
    };
  }

  const stats: Stats = {
    totalCount: stocks.length,
    avgScore: 0,
    avgAdjustedScore: 0,
    aCount: 0,
    bCount: 0,
    cCount: 0,
    dCount: 0,
    sCount: 0,
    lowRiskCount: 0,
    mediumRiskCount: 0,
    highRiskCount: 0,
  };

  let totalScore = 0;
  let totalAdjustedScore = 0;

  for (const stock of stocks) {
    totalScore += stock.score.totalScore;
    totalAdjustedScore += stock.adjustedScore;

    switch (stock.score.grade) {
      case 'S': stats.sCount++; break;
      case 'A': stats.aCount++; break;
      case 'B': stats.bCount++; break;
      case 'C': stats.cCount++; break;
      case 'D': stats.dCount++; break;
    }

    switch (stock.risk.riskLevel) {
      case 'low': stats.lowRiskCount++; break;
      case 'medium': stats.mediumRiskCount++; break;
      case 'high': stats.highRiskCount++; break;
    }
  }

  stats.avgScore = Math.round(totalScore / stocks.length * 10) / 10;
  stats.avgAdjustedScore = Math.round(totalAdjustedScore / stocks.length * 10) / 10;

  return stats;
}

function StatCard({ icon, label, value, suffix, color = 'text-ink-900', bgColor = 'bg-ink-50' }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  suffix?: string;
  color?: string;
  bgColor?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-ink-200 bg-white p-3', bgColor)}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-ink-400">{label}</span>
      </div>
      <div className={cn('text-lg font-bold', color)}>
        {value}{suffix}
      </div>
    </div>
  );
}

function GradeDistribution({ stats }: { stats: Stats }) {
  const totalGrades = stats.sCount + stats.aCount + stats.bCount + stats.cCount + stats.dCount;
  if (totalGrades === 0) return null;

  const sPct = Math.round((stats.sCount / totalGrades) * 100);
  const aPct = Math.round((stats.aCount / totalGrades) * 100);
  const bPct = Math.round((stats.bCount / totalGrades) * 100);
  const cPct = Math.round((stats.cCount / totalGrades) * 100);
  const dPct = Math.round((stats.dCount / totalGrades) * 100);

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <Award size={14} className="text-ink-400" />
        <span className="text-sm font-semibold text-ink-900">评级分布</span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-purple-600 font-medium">S级</span>
            <span className="text-ink-500">{stats.sCount}只 ({sPct}%)</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${sPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-green-600 font-medium">A级</span>
            <span className="text-ink-500">{stats.aCount}只 ({aPct}%)</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${aPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-blue-600 font-medium">B级</span>
            <span className="text-ink-500">{stats.bCount}只 ({bPct}%)</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${bPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-yellow-600 font-medium">C级</span>
            <span className="text-ink-500">{stats.cCount}只 ({cPct}%)</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-500 rounded-full transition-all" style={{ width: `${cPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-red-600 font-medium">D级</span>
            <span className="text-ink-500">{stats.dCount}只 ({dPct}%)</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${dPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskDistribution({ stats }: { stats: Stats }) {
  const totalRisk = stats.lowRiskCount + stats.mediumRiskCount + stats.highRiskCount;
  if (totalRisk === 0) return null;

  const lowPct = Math.round((stats.lowRiskCount / totalRisk) * 100);
  const mediumPct = Math.round((stats.mediumRiskCount / totalRisk) * 100);
  const highPct = Math.round((stats.highRiskCount / totalRisk) * 100);

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-ink-400" />
        <span className="text-sm font-semibold text-ink-900">风险分布</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-green-600">低风险</span>
            <span className="text-ink-500">{stats.lowRiskCount}只</span>
          </div>
          <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${lowPct}%` }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-yellow-600">中风险</span>
            <span className="text-ink-500">{stats.mediumRiskCount}只</span>
          </div>
          <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-500 rounded-full transition-all" style={{ width: `${mediumPct}%` }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-red-600">高风险</span>
            <span className="text-ink-500">{stats.highRiskCount}只</span>
          </div>
          <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${highPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatsPanelProps {
  stocks: SelectorStock[];
  loading?: boolean;
}

export function StatsPanel({ stocks, loading }: StatsPanelProps) {
  const stats = calculateStats(stocks);

  if (loading) {
    return (
      <div className="rounded-lg border border-ink-200 bg-white p-6">
        <div className="grid grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-16 bg-ink-100 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="h-32 bg-ink-100 rounded-lg animate-pulse" />
          <div className="h-32 bg-ink-100 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-3">
        <StatCard
          icon={<BarChart3 size={16} />}
          label="候选总数"
          value={stats.totalCount}
          suffix="只"
        />
        <StatCard
          icon={<TrendingUp size={16} className="text-green-500" />}
          label="平均评分"
          value={stats.avgScore}
          suffix="分"
        />
        <StatCard
          icon={<Target size={16} className="text-blue-500" />}
          label="调整后得分"
          value={stats.avgAdjustedScore}
          suffix="分"
        />
        <StatCard
          icon={<Award size={16} className="text-purple-500" />}
          label="S/A级"
          value={stats.sCount + stats.aCount}
          suffix="只"
        />
        <StatCard
          icon={<Activity size={16} className="text-green-500" />}
          label="低风险"
          value={stats.lowRiskCount}
          suffix="只"
        />
        <StatCard
          icon={<AlertTriangle size={16} className="text-red-500" />}
          label="高风险"
          value={stats.highRiskCount}
          suffix="只"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <GradeDistribution stats={stats} />
        <RiskDistribution stats={stats} />
      </div>
    </div>
  );
}