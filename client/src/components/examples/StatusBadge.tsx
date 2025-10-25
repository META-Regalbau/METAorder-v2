import StatusBadge from '../StatusBadge';

export default function StatusBadgeExample() {
  return (
    <div className="flex gap-2 p-4">
      <StatusBadge status="open" />
      <StatusBadge status="in_progress" />
      <StatusBadge status="completed" />
      <StatusBadge status="cancelled" />
    </div>
  );
}
