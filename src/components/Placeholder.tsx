export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="max-w-xl mx-auto text-center py-24 space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-dim">{note}</p>
    </div>
  );
}
