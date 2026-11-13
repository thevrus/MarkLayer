import { isAgentPeer } from '@marklayer/types/agents';
import { useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useState } from 'preact/hooks';
import { localUser } from '../lib/identity';
import { activeLayer, layerChoices, roomLayers, selectLayer, setLayerVisible } from '../lib/layers';
import { operations, patchOp } from '../lib/ops';
import { peers } from '../lib/presence';
import { agentClaims, canEditFromRoom, roomTasks, wsSend } from '../lib/realtime';

export function LayerPanel({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const pending = useSignal('');
  const [renaming, setRenaming] = useState('');
  const [draft, setDraft] = useState('');
  const writable = canEditFromRoom.value !== false;
  const send = (message: object) => wsSend.value?.(message);
  useSignalEffect(() => {
    const id = pending.value;
    if (id && roomLayers.value.some((layer) => layer.id === id)) {
      selectLayer(id);
      pending.value = '';
    }
  });
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = nanoid();
    pending.value = id;
    send({ type: 'layer_create', id, name: trimmed });
    setName('');
  };
  const items = operations.value.filter(
    (op) => (op.layerId ?? 'default') === activeLayer.value && !(op.tool === 'comment' && op.parentId),
  );
  return (
    <section
      aria-label="图层管理"
      class="fixed right-4 bottom-20 z-2147483647 rounded-xl bg-white p-4 shadow-xl text-black"
      style={{ width: 320, maxHeight: '70vh', overflow: 'auto' }}
    >
      <div class="flex justify-between">
        <h2>图层</h2>
        <button type="button" onClick={onClose} aria-label="关闭图层面板">
          关闭
        </button>
      </div>
      <p>勾选显示，点击名称切换工作图层。</p>
      {layerChoices.value.map((layer) => (
        <div key={layer.id} class="flex items-center gap-2 my-2">
          <input
            type="checkbox"
            aria-label={`显示 ${layer.name}`}
            checked={layer.visible}
            disabled={layer.id === activeLayer.value}
            onChange={(e) => setLayerVisible(layer.id, e.currentTarget.checked)}
          />
          <button type="button" aria-pressed={layer.id === activeLayer.value} onClick={() => selectLayer(layer.id)}>
            {layer.name}
            {layer.id === activeLayer.value ? '（当前）' : ''}
          </button>
          {writable && (
            <button
              type="button"
              aria-label={`重命名 ${layer.name}`}
              onClick={() => {
                setRenaming(layer.id);
                setDraft(layer.name);
              }}
            >
              改名
            </button>
          )}
          {writable && layer.id !== 'default' && (
            <button
              type="button"
              aria-label={`删除 ${layer.name}`}
              onClick={() => {
                if (confirm(`删除“${layer.name}”？`)) send({ type: 'layer_delete', id: layer.id });
              }}
            >
              删除
            </button>
          )}
        </div>
      ))}
      {renaming && (
        <div class="flex gap-1">
          <input
            aria-label="图层新名称"
            value={draft}
            maxLength={80}
            onInput={(e) => setDraft(e.currentTarget.value)}
            class="border"
          />
          <button
            type="button"
            onClick={() => {
              if (draft.trim()) send({ type: 'layer_rename', id: renaming, name: draft.trim() });
              setRenaming('');
            }}
          >
            保存
          </button>
          <button type="button" onClick={() => setRenaming('')}>
            取消
          </button>
        </div>
      )}
      {writable && (
        <div class="flex gap-1 mt-3">
          <input
            aria-label="新图层名称"
            value={name}
            maxLength={80}
            onInput={(e) => setName(e.currentTarget.value)}
            class="border w-full"
          />
          <button type="button" onClick={create} disabled={!name.trim()}>
            新建
          </button>
        </div>
      )}
      <div class="mt-3">
        <h3>AI 协作</h3>
        {[
          ...new Map(
            [...peers.value.values()]
              .filter((peer) => isAgentPeer(peer.id) && peer.uid)
              .map((peer) => [peer.uid!, peer]),
          ).values(),
        ].map((peer) => {
          const claim = agentClaims.value.find((item) => item.agent_id === peer.uid);
          return (
            <div key={peer.uid} class="flex items-center gap-2 my-1">
              <span>
                {peer.name}：{claim ? `归属 ${claim.owner_name}` : '未认领'}
              </span>
              {writable && (!claim || claim.owner_id === localUser.id) && (
                <button
                  type="button"
                  onClick={() => send({ type: claim ? 'agent_release' : 'agent_claim', agentId: peer.uid })}
                >
                  {claim ? '释放' : '认领'}
                </button>
              )}
            </div>
          );
        })}
        {agentClaims.value
          .filter(
            (claim) => ![...peers.value.values()].some((peer) => isAgentPeer(peer.id) && peer.uid === claim.agent_id),
          )
          .map((claim) => (
            <div key={claim.agent_id} class="flex items-center gap-2 my-1">
              <span>
                {claim.agent_id}：离线，归属 {claim.owner_name}
              </span>
              {writable && claim.owner_id === localUser.id && (
                <button type="button" onClick={() => send({ type: 'agent_release', agentId: claim.agent_id })}>
                  释放
                </button>
              )}
            </div>
          ))}
        {roomTasks.value
          .filter((task) => !['completed', 'cancelled'].includes(task.status))
          .map((task) => (
            <div key={task.id} class="my-1">
              <span>
                {task.requester_name} → {task.agent_id}：
                {
                  {
                    queued: '排队中',
                    running: '进行中',
                    waiting: `等待 ${task.waiting_for ?? '答复'}`,
                    cancel_requested: '等待 AI 确认停止',
                    completed: '已完成',
                    cancelled: '已取消',
                  }[task.status]
                }
                （{roomLayers.value.find((layer) => layer.id === task.layer_id)?.name ?? task.layer_id}）
              </span>
              {writable && task.status !== 'cancel_requested' && (
                <button type="button" onClick={() => send({ type: 'task_cancel', taskId: task.id })}>
                  取消任务
                </button>
              )}
            </div>
          ))}
        {!roomTasks.value.some((task) => !['completed', 'cancelled'].includes(task.status)) && (
          <p>暂无任务。评论中 @AI 即可指派。</p>
        )}
      </div>
      {writable && (
        <div class="mt-3">
          <h3>移动当前图层内容</h3>
          {items.length === 0 ? (
            <p>暂无内容</p>
          ) : (
            items.map((op) => (
              <label key={op.id} class="flex gap-2 my-1">
                <span>{op.tool === 'comment' ? op.text || '评论' : op.tool}</span>
                <select
                  aria-label={`移动 ${op.id}`}
                  value={op.layerId ?? 'default'}
                  onChange={(e) => patchOp({ opId: op.id, patch: { layerId: e.currentTarget.value } })}
                >
                  {roomLayers.value.map((layer) => (
                    <option value={layer.id} key={layer.id}>
                      {layer.name}
                    </option>
                  ))}
                </select>
              </label>
            ))
          )}
        </div>
      )}
    </section>
  );
}
