import { Card } from '@/components/ui/card';

export default function StatCard({ value, label }) {
  return (
    <Card className="group py-6 px-5 text-center relative overflow-hidden transition-all hover:border-border hover:-translate-y-[3px] hover:shadow-md">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="font-sans text-[2rem] font-bold text-foreground tracking-[-0.02em]">{value}</div>
      <div className="text-[0.78rem] text-muted-foreground mt-[0.3rem] uppercase tracking-[0.06em] font-medium">{label}</div>
    </Card>
  );
}
