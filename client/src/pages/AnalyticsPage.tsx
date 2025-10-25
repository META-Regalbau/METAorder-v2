import { Card } from "@/components/ui/card";
import { TrendingUp, Package, DollarSign, Clock } from "lucide-react";

export default function AnalyticsPage() {
  // TODO: Replace with real data from API
  const stats = [
    {
      title: "Total Orders",
      value: "1,234",
      change: "+12.5%",
      icon: Package,
      trend: "up",
    },
    {
      title: "Revenue",
      value: "$45,678",
      change: "+8.2%",
      icon: DollarSign,
      trend: "up",
    },
    {
      title: "Avg. Processing Time",
      value: "2.3 days",
      change: "-15.3%",
      icon: Clock,
      trend: "down",
    },
    {
      title: "Completion Rate",
      value: "94.2%",
      change: "+3.1%",
      icon: TrendingUp,
      trend: "up",
    },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Order performance and insights
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <Card key={stat.title} className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{stat.title}</span>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{stat.value}</span>
              <span
                className={`text-sm ${
                  stat.trend === "up" ? "text-green-600" : "text-red-600"
                }`}
              >
                {stat.change}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          Order Status Distribution
        </h2>
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          {/* TODO: Add charts/graphs here */}
          Charts and analytics visualization will be implemented here
        </div>
      </Card>
    </div>
  );
}
