import { LLM_MODELS } from '@/config/llm';
import { useAppStore } from '@/store';

export function ModelPicker() {
  const modelId = useAppStore((s) => s.modelId);
  const setModelId = useAppStore((s) => s.setModelId);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ink-400">模型</span>
      <select
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        className="rounded border border-ink-200 bg-white px-2 py-1 text-xs outline-none focus:border-ink-400"
      >
        {LLM_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
            {m.good_at ? ` · ${m.good_at}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
